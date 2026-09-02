/**
 * 只读展示站的「登录」：往 localStorage 里塞一份 guest 的凭据，让 Emby 网页端
 * 以为自己已经登录，直接进主页 / 深链。
 *
 * 这里的 AccessToken 是假的（"public"）。真 token 由 nginx 在转发时覆盖进去，
 * 浏览器永远拿不到它 —— 这是整站的安全前提，别把真 token 挪到这里来。
 *
 * __GUEST_USER_ID__ 由 nginx 的 sub_filter 换成 .env 里的 EMBY_GUEST_USER_ID。
 */
(function () {
    'use strict';

    var STORAGE_KEY = 'servercredentials3';
    var USER_ID = '__GUEST_USER_ID__';
    var FAKE_TOKEN = 'public';

    function hasGuestCredentials() {
        try {
            var credentials = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            var server = (credentials.Servers || [])[0];
            if (!server || server.UserId !== USER_ID) return false;
            return (server.Users || []).some(function (u) {
                return u.UserId === USER_ID && u.AccessToken === FAKE_TOKEN;
            });
        } catch (e) {
            return false;
        }
    }

    function saveGuestCredentials() {
        // 之前如果存过别的（比如从 emby.lyjw131.com 复制来的），整份覆盖：
        // 这个域名只认 guest
        var credentials = {
            Servers: [{
                ManualAddress: window.location.protocol + '//' + window.location.host,
                ManualAddressOnly: true,
                IsLocalServer: true,
                UserId: USER_ID,
                Users: [{ UserId: USER_ID, AccessToken: FAKE_TOKEN }],
                DateLastAccessed: Date.now(),
                LastConnectionMode: 2
            }]
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(credentials));
        localStorage.setItem(USER_ID + '-appTheme', 'appletv');
        localStorage.setItem(USER_ID + '-settingsTheme', 'maintheme');
        console.log('[guest] credentials written');
    }

    /**
     * 网页端的「登出」会 POST /Sessions/Logout —— nginx 已经 403 了它（登出会吊销
     * 共享的 guest token），这里再把本地那步也拦下：清掉凭据后重新写一份、回首页。
     */
    function interceptLogout() {
        var originalFetch = window.fetch;
        window.fetch = function () {
            var url = arguments[0];
            var urlString = typeof url === 'string' ? url : (url && url.url ? url.url : '');
            if (urlString.indexOf('/Sessions/Logout') !== -1) {
                saveGuestCredentials();
                window.location.href = '/web/index.html';
                return new Promise(function () {});
            }
            return originalFetch.apply(this, arguments);
        };
    }

    /**
     * 操作面板（actionSheet）：长按卡片、点「更多」、右键都会弹一张，里面全是
     * 播放 / 已看 / 收藏 / 删除这类操作。按钮本身由 guest.css 藏了，这里兜底：
     * 面板一进 DOM 就拆掉，键盘快捷键之类绕过按钮的路径也就断了。
     * 普通对话框（比如「播放受到限制」的提示）不动。
     */
    function killActionSheets() {
        var sweep = function (root) {
            if (!root.querySelectorAll) return;
            var sheets = root.querySelectorAll('.actionSheet');
            for (var i = 0; i < sheets.length; i++) {
                var container = sheets[i].closest('.dialogContainer') || sheets[i];
                container.remove();
            }
            // 缩略图 / 海报容器自带「点了就播」，专辑里的曲目行是「从这里开始播」：
            // 容器本身不能藏（剧季页每集的缩略图、专辑的整份曲目列表就是它们，踩过两次），
            // 改写动作：有条目页的跳条目页，曲目行改成什么都不做；独立的小播放按钮才藏。
            var selector = '[data-action="play"],[data-action="resume"],[data-action="playallfromhere"],[data-action="queueallfromhere"]';
            // querySelectorAll 只查子孙；虚拟列表是把每一行本身当新节点插进来的，节点自己也得查
            var playables = Array.prototype.slice.call(root.querySelectorAll(selector));
            if (root.matches && root.matches(selector)) playables.push(root);
            for (var k = 0; k < playables.length; k++) {
                var el = playables[k];
                var action = el.getAttribute('data-action');
                var isContainer = el.classList.contains('listItemImageContainer') ||
                    el.classList.contains('cardImageContainer') ||
                    el.classList.contains('listItem') ||
                    el.classList.contains('card');
                if (!isContainer) {
                    el.style.display = 'none';
                } else if (action === 'play' || action === 'resume') {
                    el.setAttribute('data-action', 'link');
                } else {
                    el.setAttribute('data-action', 'none');
                }
            }
            var backdrops = document.querySelectorAll('.dialogBackdrop');
            if (!document.querySelector('.dialogContainer')) {
                for (var j = 0; j < backdrops.length; j++) backdrops[j].remove();
            }
        };
        var observer = new MutationObserver(function (mutations) {
            for (var i = 0; i < mutations.length; i++) {
                var added = mutations[i].addedNodes;
                for (var j = 0; j < added.length; j++) {
                    if (added[j].nodeType === 1) sweep(added[j]);
                }
            }
        });
        var start = function () {
            observer.observe(document.body, { childList: true, subtree: true });
        };
        if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
    }

    interceptLogout();
    killActionSheets();
    if (!hasGuestCredentials()) {
        saveGuestCredentials();
    }
})();
