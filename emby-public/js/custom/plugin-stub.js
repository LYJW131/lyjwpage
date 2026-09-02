/**
 * 播放器 / 投屏 / 远程控制 / 屏保插件的空壳。
 *
 * Emby Web 启动时会把 app.js 里列的插件挨个 require 进来再 `new` 一遍，其中播放器那几个
 * 又各自拖一串依赖（htmlvideoplayer → basehtmlplayer / htmlmediahelper / subtitle…，
 * chromecast → gstatic 的 cast_sender.js）。只读站永远用不上它们，nginx 对那些 URL 直接
 * 回这一份：形状和真插件一样（`_exports.default` 是构造函数，实例有 id / type），
 * pluginmanager 注册完就没人再找它 —— type 不是 "mediaplayer" / "screensaver"，谁也不会挑到。
 *
 * id 要唯一：pluginmanager 按 id 去重，重复的会被静默跳过，看着像没加载成功。
 * 哪些模块走这份见 nginx.conf.template。
 */
define(["exports"], function (_exports) {
    Object.defineProperty(_exports, "__esModule", { value: true });
    window.__guestStubCount = (window.__guestStubCount || 0) + 1;
    var n = window.__guestStubCount;
    _exports.default = function () {
        this.name = "guest-stub";
        this.id = "guest-stub-" + n;
        this.type = "guest-stub";
    };
});
