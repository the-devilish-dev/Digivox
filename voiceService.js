/**
 * DigiVoX Voice Service - shared module for Fish Audio voice fetching.
 *
 * Used by: DigiVoice.html, PodcastGen.html, ScriptedPerformance.html
 * Purpose: replace hardcoded voice lists with live community + cloned voice data.
 *
 * Exposes a global: DigiVoX_VoiceService
 */
(function (global) {
    'use strict';

    const LS_KEYS = {
        fishKey:    'devilish_fish_key',
        serverBase: 'devilish_server_base',
        cacheComm:  'digivox_cached_community_voices',
        cacheMine:  'digivox_cached_my_voices',
    };

    const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

    // --- State -------------------------------------------------------------
    const state = {
        community: [],       // { id, name, description, languages, ... }
        myVoices:  [],
        loading:   false,
        lastError: null,
    };

    // --- Utilities ---------------------------------------------------------
    function getFishKey()    { return localStorage.getItem(LS_KEYS.fishKey) || ''; }
    function getServerBase() { return (localStorage.getItem(LS_KEYS.serverBase) || '').replace(/\/$/, ''); }

    function normalizeVoice(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const id   = raw._id || raw.id;
        const name = raw.title || raw.name || 'Unnamed Voice';
        if (!id) return null;
        return {
            id,
            name,
            description: raw.description || raw.desc || '',
            languages:   Array.isArray(raw.languages) ? raw.languages : [],
            tags:        Array.isArray(raw.tags) ? raw.tags : [],
            author:      raw.author ? (raw.author.nickname || raw.author._id || '') : '',
            coverImage:  raw.cover_image || raw.coverImage || '',
            createdAt:   raw.created_at || raw.createdAt || new Date().toISOString(),
            updatedAt:   raw.updated_at || raw.updatedAt || '',
            taskCount:   raw.task_count || 0,
            likeCount:   raw.like_count || 0,
            source:      raw,
        };
    }

    function normalizeList(data) {
        let arr = [];
        if (Array.isArray(data)) {
            arr = data;
        } else if (data && Array.isArray(data.items)) {
            arr = data.items;
        } else if (data && Array.isArray(data.data)) {
            arr = data.data;
        } else if (data && Array.isArray(data.voices)) {
            arr = data.voices;
        } else if (data && Array.isArray(data.models)) {
            arr = data.models;
        }
        return arr.map(normalizeVoice).filter(Boolean);
    }

    function buildUrl(serverBase, proxyPath, params) {
        const qs = new URLSearchParams(params).toString();
        if (serverBase) {
            return `${serverBase}${proxyPath}${qs ? '?' + qs : ''}`;
        }
        // Same-origin routes only when served by dl_proxy.js (port 2345)
        if (typeof location !== 'undefined' && location.protocol.startsWith('http') && String(location.port) === '2345') {
            return `${proxyPath}${qs ? '?' + qs : ''}`;
        }
        // Inside the DigiVoX APK (WebView serves from https://localhost): the Termux
        // dl_proxy on the same device handles fish calls; direct api.fish.audio is CORS-blocked.
        if (typeof location !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
            return `http://localhost:2345${proxyPath}${qs ? '?' + qs : ''}`;
        }
        // Direct Fish Audio endpoint (documented GET https://api.fish.audio/model)
        return `https://api.fish.audio/model${qs ? '?' + qs : ''}`;
    }

    function readCache(key) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || Date.now() - parsed.ts > CACHE_TTL_MS) return null;
            return parsed.data;
        } catch (e) {
            return null;
        }
    }

    function writeCache(key, data) {
        try {
            localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
        } catch (e) {
            // Storage might be full; ignore.
        }
    }

    async function fetchVoices({ selfOnly = false, pageSize = 100, sortBy = 'task_count', title = '', language = '' } = {}) {
        const apiKey = getFishKey();
        if (!apiKey) {
            throw new Error('Fish Audio API key not set. Add it in Settings.');
        }

        const serverBase = getServerBase();
        const proxyPath  = selfOnly ? '/my-voices' : '/voices';
        const params = {
            page_size:   String(pageSize),
            page_number: '1',
            sort_by:     sortBy,
        };
        if (selfOnly) params.self = 'true';
        if (title)    params.title = title;
        if (language) params.language = language;

        const url = buildUrl(serverBase, proxyPath, params);

        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });

        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Fish Audio voices request failed (${res.status}): ${text || res.statusText}`);
        }

        const data = await res.json();
        return normalizeList(data);
    }

    // --- Public API --------------------------------------------------------
    const service = {
        /**
         * Fetch public community voices from Fish Audio.
         * Options: { pageSize, sortBy, title, language, useCache }
         */
        async fetchCommunity(options = {}) {
            const useCache = options.useCache !== false;
            if (useCache && state.community.length) return state.community;
            const cached = useCache ? readCache(LS_KEYS.cacheComm) : null;
            if (cached) { state.community = cached; return cached; }

            const voices = await fetchVoices({ ...options, selfOnly: false });
            state.community = voices;
            writeCache(LS_KEYS.cacheComm, voices);
            return voices;
        },

        /**
         * Fetch the user's own cloned voices from Fish Audio.
         * Options: { pageSize, sortBy, title, language, useCache }
         */
        async fetchMyVoices(options = {}) {
            const useCache = options.useCache !== false;
            if (useCache && state.myVoices.length) return state.myVoices;
            const cached = useCache ? readCache(LS_KEYS.cacheMine) : null;
            if (cached) { state.myVoices = cached; return cached; }

            const voices = await fetchVoices({ ...options, selfOnly: true, sortBy: options.sortBy || 'created_at' });
            state.myVoices = voices;
            writeCache(LS_KEYS.cacheMine, voices);
            return voices;
        },

        /**
         * Fetch both lists in parallel.
         * Returns: { community: [...], myVoices: [...] }
         */
        async fetchAll(options = {}) {
            const [community, myVoices] = await Promise.all([
                this.fetchCommunity(options).catch(err => { console.warn('Community voices fetch failed:', err); return []; }),
                this.fetchMyVoices(options).catch(err => { console.warn('My voices fetch failed:', err); return []; }),
            ]);
            return { community, myVoices };
        },

        /**
         * Refresh both lists (bypass cache).
         */
        async refreshAll(options = {}) {
            state.community = [];
            state.myVoices  = [];
            localStorage.removeItem(LS_KEYS.cacheComm);
            localStorage.removeItem(LS_KEYS.cacheMine);
            return this.fetchAll({ ...options, useCache: false });
        },

        /**
         * Populate a <select> element with community + my-voices optgroups.
         *
         * @param {HTMLSelectElement} selectEl
         * @param {Object} opts
         *   - community: array (optional; fetched live if omitted and api key present)
         *   - myVoices:  array (optional)
         *   - placeholder: string
         *   - myGroupLabel: string
         *   - commGroupLabel: string
         *   - selectedId: string
         *   - loadingLabel: string
         * @returns {Promise<void>}
         */
        async populateSelect(selectEl, opts = {}) {
            if (!selectEl) return;

            const placeholder = opts.placeholder || '- Select a voice -';
            const myLabel     = opts.myGroupLabel || '\u2605 My Clones';
            const commLabel   = opts.commGroupLabel || '\ud83c\udf10 Community Voices';
            const selectedId  = opts.selectedId || selectEl.value || '';

            // Clear but keep placeholder
            selectEl.innerHTML = `<option value="">${escHtml(placeholder)}</option>`;

            let community = opts.community;
            let myVoices  = opts.myVoices;

            // Auto-fetch if arrays not supplied
            if (!Array.isArray(community) || !Array.isArray(myVoices)) {
                if (getFishKey()) {
                    selectEl.options[0].textContent = placeholder + ' (loading...)';
                    try {
                        const fetched = await this.fetchAll({ useCache: true });
                        if (!Array.isArray(community)) community = fetched.community;
                        if (!Array.isArray(myVoices))  myVoices  = fetched.myVoices;
                    } catch (e) {
                        console.warn('DigiVoX_VoiceService populateSelect fetch failed:', e);
                    } finally {
                        selectEl.options[0].textContent = placeholder;
                    }
                }
            }

            community = community || [];
            myVoices  = myVoices  || [];

            // My voices group first
            if (myVoices.length) {
                const grp = document.createElement('optgroup');
                grp.label = myLabel;
                myVoices.forEach(v => {
                    const opt = document.createElement('option');
                    opt.value = v.id;
                    opt.textContent = v.name;
                    grp.appendChild(opt);
                });
                selectEl.appendChild(grp);
            }

            // Community voices group
            if (community.length) {
                const grp = document.createElement('optgroup');
                grp.label = commLabel;
                community.forEach(v => {
                    const opt = document.createElement('option');
                    opt.value = v.id;
                    opt.textContent = v.name;
                    grp.appendChild(opt);
                });
                selectEl.appendChild(grp);
            }

            if (selectedId) selectEl.value = selectedId;
        },

        /**
         * Return a flat list of all voices (community + mine) for cases that need it.
         * Optionally prefixes my voices with a star.
         */
        getAllVoices(prefixMy = '\u2605 ') {
            const mine = state.myVoices.map(v => ({ ...v, name: prefixMy ? prefixMy + v.name : v.name }));
            return [...mine, ...state.community];
        },

        /**
         * Direct access to current in-memory lists.
         */
        get state() {
            return { community: [...state.community], myVoices: [...state.myVoices] };
        },

        /**
         * Reset in-memory state and cache.
         */
        clear() {
            state.community = [];
            state.myVoices  = [];
            localStorage.removeItem(LS_KEYS.cacheComm);
            localStorage.removeItem(LS_KEYS.cacheMine);
        },

        normalizeVoice,
        normalizeList,
        getFishKey,
        getServerBase,
    };

    function escHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '"')
            .replace(/'/g, '&#039;');
    }

    // Expose globally
    global.DigiVoX_VoiceService = service;

})(typeof window !== 'undefined' ? window : globalThis);
