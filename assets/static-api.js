/*
 * static-api.js — 정적 배포용 백엔드 셰임(shim)
 * ------------------------------------------------------------------
 * 원래 server.py(:9000)가 처리하던 /api/* 호출을 클라이언트에서 가로채,
 * 번들된 정적 JSON(./data/*.json) + localStorage 작업본으로 응답한다.
 *
 *  - GET  /api/config       → 단일 'sample' 환경
 *  - GET  /api/load         → 기본 스냅샷에 localStorage 변경분을 덮어 반환
 *  - GET  /api/committed    → 기본 스냅샷(원본) 그대로 반환  ("현재 vs 기본값" 비교용)
 *  - GET  /api/characters   → 번들 CharacterStat.json 에서 필드 추림
 *  - GET  /api/writable     → 항상 열림
 *  - POST /api/save         → 변경분을 localStorage 작업본에 병합
 *  - POST /api/git          → no-op(revert만 작업본 초기화)
 *
 * 추가로: Git 버튼 숨김 + 좌하단 '내보내기/기본값' 바 주입.
 * 반드시 각 대시보드의 인라인 스크립트보다 먼저 로드되어야 한다(<head>에 주입).
 */
(function () {
  'use strict';

  var DATA_BASE = './data/';
  var ENV_NAME = 'sample';
  var LS_PREFIX = 'balcalc:';

  var origFetch = window.fetch ? window.fetch.bind(window) : null;
  var pristineCache = {};

  function loadPristine(file) {
    if (pristineCache[file]) return Promise.resolve(pristineCache[file]);
    return origFetch(DATA_BASE + file + '.json').then(function (r) {
      if (!r.ok) throw new Error('data not found: ' + file);
      return r.json();
    }).then(function (j) { pristineCache[file] = j; return j; });
  }

  function lsKey(file) { return LS_PREFIX + file; }
  function loadOverrides(file) {
    try { return JSON.parse(localStorage.getItem(lsKey(file)) || '{}'); }
    catch (e) { return {}; }
  }
  function saveOverrides(file, obj) {
    localStorage.setItem(lsKey(file), JSON.stringify(obj));
  }
  function merged(file, pristine) {
    return Object.assign({}, pristine, loadOverrides(file));
  }

  function jsonResponse(obj, status) {
    return new Response(JSON.stringify(obj), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  // 절대 URL(예: http://127.0.0.1:9000/api/..)에서 origin 제거 → '/api/..'
  function apiPath(url) {
    return String(url).replace(/^https?:\/\/[^/]+/, '');
  }

  window.fetch = function (input, init) {
    var rawUrl = (typeof input === 'string') ? input : (input && input.url) || '';
    var path = apiPath(rawUrl);
    if (path.indexOf('/api/') !== 0) return origFetch(input, init);

    var u = new URL('http://x' + path);
    var seg = u.pathname;
    var qs = u.searchParams;
    var method = ((init && init.method) || (typeof input === 'object' && input.method) || 'GET').toUpperCase();

    return (async function () {
      try {
        if (seg === '/api/config') {
          return jsonResponse({ repo_path: '(static)', default_env: ENV_NAME, environments: [ENV_NAME] });
        }
        if (seg === '/api/writable') {
          return jsonResponse({ protected: false });
        }
        if (seg === '/api/load') {
          var lf = qs.get('file');
          var lp = await loadPristine(lf);
          return jsonResponse({ file: lf, env: ENV_NAME, data: merged(lf, lp) });
        }
        if (seg === '/api/committed') {
          var cf = qs.get('file');
          var cp = await loadPristine(cf);
          return jsonResponse({ file: cf, env: ENV_NAME, data: cp });
        }
        if (seg === '/api/characters') {
          var pristine = await loadPristine('CharacterStat');
          var fields = (qs.get('fields') || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
          var activeOnly = (qs.get('active_only') || '').toLowerCase() === 'true';
          var arr = pristine.statBaseArray || [];
          var result = [];
          for (var i = 0; i < arr.length; i++) {
            var c = arr[i];
            var name = c.characterName;
            if (!name) continue;
            var ctype = c.characterType || 0;
            var isActive = ctype > 0 && ctype < 200;
            var entry;
            if (fields.length) {
              entry = { name: name, active: isActive, characterType: ctype };
              for (var f = 0; f < fields.length; f++) if (fields[f] in c) entry[fields[f]] = c[fields[f]];
            } else {
              entry = Object.assign({}, c, { name: name, active: isActive });
            }
            if (activeOnly && !isActive) continue;
            result.push(entry);
          }
          var active_list = result.filter(function (r) { return r.active; }).map(function (r) { return r.name; });
          return jsonResponse({ env: ENV_NAME, count: result.length, active_list: active_list, characters: result });
        }
        if (seg === '/api/save' && method === 'POST') {
          var body = (init && init.body) ? JSON.parse(init.body) : {};
          var file = body.file, patch = body.patch || {};
          var sp = await loadPristine(file);
          var ov = loadOverrides(file);
          var changed = {};
          for (var k in patch) {
            if (!(k in sp)) continue;
            var old = (k in ov) ? ov[k] : sp[k];
            ov[k] = patch[k];
            changed[k] = { old: old, new: patch[k] };
          }
          saveOverrides(file, ov);
          window.dispatchEvent(new CustomEvent('balcalc:changed'));
          return jsonResponse({ ok: true, file: file, env: ENV_NAME, changed: changed, path: '(localStorage)' });
        }
        if (seg === '/api/git' && method === 'POST') {
          var gb = (init && init.body) ? JSON.parse(init.body) : {};
          if (gb.action === 'revert') {
            var files = gb.files || [];
            if (files.length) {
              files.forEach(function (fp) {
                var m = String(fp).match(/([^/\\]+)\.json$/);
                if (m) localStorage.removeItem(lsKey(m[1]));
              });
            }
            window.dispatchEvent(new CustomEvent('balcalc:changed'));
            return jsonResponse({ ok: true, output: '정적 데모: 기본값으로 되돌렸습니다.' });
          }
          return jsonResponse({ ok: true, output: '정적 데모 모드 · 변경은 이 브라우저(localStorage)에만 저장됩니다.' });
        }
        return jsonResponse({ error: 'unknown api ' + seg }, 404);
      } catch (e) {
        return jsonResponse({ error: String(e) }, 500);
      }
    })();
  };

  // ──────────────────────────────────────────────────────────────
  //  UI: Git 버튼 숨김 + 내보내기/기본값 바
  // ──────────────────────────────────────────────────────────────
  function currentFiles() {
    var out = [];
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (key && key.indexOf(LS_PREFIX) === 0) out.push(key.slice(LS_PREFIX.length));
    }
    return out;
  }

  function exportAll() {
    var files = currentFiles();
    if (!files.length) { alert('변경된 값이 없습니다. 슬라이더를 조정하고 "적용"한 뒤 내보내세요.'); return; }
    files.reduce(function (chain, file) {
      return chain.then(function () {
        return loadPristine(file).then(function (p) {
          var data = merged(file, p);
          var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = file + '.json';
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
        });
      });
    }, Promise.resolve());
  }

  function resetAll() {
    if (!confirm('이 브라우저에 저장된 모든 튜닝을 기본값으로 되돌릴까요?')) return;
    currentFiles().forEach(function (f) { localStorage.removeItem(LS_PREFIX + f); });
    location.reload();
  }

  function updateBar() {
    var n = currentFiles().length;
    var badge = document.getElementById('balcalc-badge');
    if (badge) badge.textContent = n ? ('정적 데모 · 변경 ' + n + '개 파일(이 브라우저에 저장)') : '정적 데모 · 변경은 이 브라우저에만 저장';
  }

  function enhanceUI() {
    // Git Commit / Push 버튼 숨김
    Array.prototype.forEach.call(document.querySelectorAll('button'), function (b) {
      var t = (b.textContent || '').trim();
      if (/Git\s*Commit|Git\s*Push/i.test(t) || /⚡/.test(t)) b.style.display = 'none';
    });
    if (document.getElementById('balcalc-exportbar')) { updateBar(); return; }
    var bar = document.createElement('div');
    bar.id = 'balcalc-exportbar';
    bar.style.cssText = 'position:fixed;bottom:16px;left:16px;z-index:99999;display:flex;gap:8px;align-items:center;font-family:Inter,system-ui,sans-serif';
    bar.innerHTML =
      '<span id="balcalc-badge" style="font-size:11px;color:#a1a1aa;background:rgba(9,9,11,.85);border:1px solid rgba(255,255,255,.08);padding:5px 10px;border-radius:6px">정적 데모 · 변경은 이 브라우저에만 저장</span>' +
      '<button id="balcalc-export" style="font-size:12px;font-weight:600;padding:6px 12px;border-radius:6px;border:1px solid rgba(129,140,248,.5);background:#818cf8;color:#fff;cursor:pointer">⬇ JSON 내보내기</button>' +
      '<button id="balcalc-reset" style="font-size:12px;font-weight:600;padding:6px 12px;border-radius:6px;border:1px solid rgba(248,113,113,.4);background:transparent;color:#f87171;cursor:pointer">↺ 기본값</button>';
    document.body.appendChild(bar);
    document.getElementById('balcalc-export').onclick = exportAll;
    document.getElementById('balcalc-reset').onclick = resetAll;
    window.addEventListener('balcalc:changed', updateBar);
    updateBar();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enhanceUI);
  else enhanceUI();
})();
