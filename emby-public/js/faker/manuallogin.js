define([
    "exports",
    "./../modules/viewmanager/baseview.js",
    "./../modules/loading/loading.js",
    "./../modules/emby-elements/emby-input/emby-input.js",
    "./../modules/emby-elements/emby-button/emby-button.js",
    "./../modules/emby-elements/emby-toggle/emby-toggle.js",
    "./../modules/emby-elements/emby-scroller/emby-scroller.js",
    "./../modules/emby-apiclient/connectionmanager.js",
    "./../modules/approuter.js",
    "./../modules/focusmanager.js",
    "./../modules/common/servicelocator.js",
    "./../modules/common/textencoding.js",
    "../modules/common/globalize.js"
], function (
    _exports,
    _baseview,
    _loading,
    _embyInput,
    _embyButton,
    _embyToggle,
    _embyScroller,
    _connectionmanager,
    _approuter,
    _focusmanager,
    _servicelocator,
    _textencoding,
    _globalize
) {
    function View(view, params) {
        // 调用父类构造函数
        _baseview.default.apply(this, arguments);

        // 替换为等待页面
        view.innerHTML = `
            <div class="app-splash-container">
                <div class="app-splash app-splash-expanded"></div>
            </div>
        `;
    }

    // ES Module 导出配置
    Object.defineProperty(_exports, "__esModule", { value: true });
    _exports.default = void 0;

    require(["material-icons"]);

    // 继承 baseview 的原型
    Object.assign(View.prototype, _baseview.default.prototype);

    // 重写 onResume 生命周期方法
    View.prototype.onResume = function (options) {
        _baseview.default.prototype.onResume.apply(this, arguments);
        _loading.default.hide();
    };

    _exports.default = View;
});