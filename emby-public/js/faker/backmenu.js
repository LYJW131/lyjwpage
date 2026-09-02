define([
    "exports",
    "./../emby-apiclient/connectionmanager.js", // 连接管理器（处理服务器连接、登录状态）
    "./../common/servicelocator.js",            // 服务定位器（获取应用宿主能力，如是否支持关机）
    "./../layoutmanager.js",                    // 布局管理器（判断是否为电视端 TV 布局）
    "./../common/globalize.js",                 // 国际化模块（处理多语言翻译）
    "./../approuter.js",                        // 路由管理器（处理页面跳转）
    "./../actionsheet/actionsheet.js",          // 弹出操作表 UI 组件
    "./../common/itemmanager/itemmanager.js"    // 项目管理器（获取图标等）
], function (
    _exports,
    _connectionmanager,
    _servicelocator,
    _layoutmanager,
    _globalize,
    _approuter,
    _actionsheet,
    _itemmanager
) {
    // 标记为 ES 模块导出
    Object.defineProperty(_exports, "__esModule", { value: true });
    _exports.default = void 0;

    /**
     * 导出默认函数，该函数用于弹出和处理“用户菜单”
     * @param {Object} options - 菜单的配置选项（如位置、是否显示特定项等）
     */
    _exports.default = function (options) {
        // 1. 获取当前正在使用的 API 客户端实例
        var apiClient = _connectionmanager.default.currentApiClient();

        // 2. 获取当前已在设备上登录的所有用户列表（返回 Promise）
        var getSignedInUsersPromise = (function (apiClient) {
            return apiClient ? _connectionmanager.default.getSignedInUsers(apiClient) : Promise.resolve([]);
        })(apiClient);

        return getSignedInUsersPromise.then(function (signedInUsers) {
            
            // 3. 获取当前正在操作的活动用户（返回 Promise）
            var getCurrentUserPromise = (function (apiClient) {
                return apiClient ? apiClient.getCurrentUser() : Promise.resolve(null);
            })(apiClient);

            return getCurrentUserPromise.then(function (user) {

                /**
                 * 辅助函数：根据用户的权限和设备支持的能力，构建菜单项数组
                 */
                function buildMenuItems(options, apiClient, user, signedInUsers) {
                    var items = [];
                    // 判断是否在 TV 模式下并且宿主程序支持“退出”功能
                    var showExit = _layoutmanager.default.tv && _servicelocator.appHost.supports("exit");
                    var exitFirst = options.exitFirst;

                    // 如果要求把“退出”放第一位，则推入退出按钮
                    if (showExit && exitFirst) {
                        items.push({
                            name: _globalize.default.translate("Exit"), // 翻译 "退出"
                            id: "exit",
                            icon: "&#xe879;" // 字体图标
                        });
                    }

                    // 除非选项中明确禁用 settings，否则推入“应用设置”选项
                    if (options.settings !== false) {
                        items.push({
                            name: _globalize.default.translate("HeaderAppSettings"),
                            id: "settings",
                            icon: "&#xe8B8;",
                            // 次要文本显示 App 名称和版本号
                            secondaryText: _servicelocator.appHost.appName() + " " + _servicelocator.appHost.appVersion()
                        });
                    }

                    // 如果有用户信息，且用户是管理员，且存在“管理服务器”的路由页面
                    if (user && user.Policy.IsAdministrator && _approuter.default.getRouteInfo(_approuter.default.getRouteUrl("manageserver"))) {
                        items.push({
                            name: _globalize.default.translate("ManageEmbyServer"), // 翻译 "管理服务器"
                            id: "manageserver",
                            icon: "dashboard"
                        });
                    }

                    // 如果应用宿主支持“多服务器”功能
                    if (_servicelocator.appHost.supports("multiserver")) {
                        items.push({
                            name: _globalize.default.translate("HeaderChangeServer"), // 翻译 "切换服务器"
                            id: "selectserver",
                            icon: _itemmanager.default.getDefaultIcon({ Type: "Server" })
                        });
                    }

                    // 获取用户的默认头像图标，备用
                    var userIcon = _itemmanager.default.getDefaultIcon(user);

                    // 如果存在 apiClient 且用户不是通过 Emby Connect (云账户) 登录的
                    if (apiClient && !_connectionmanager.default.isLoggedIntoConnect()) {
                        // 遍历该设备上登录的其他用户，提供快速切换功能
                        for (var i = 0, length = signedInUsers.length; i < length; i++) {
                            var signedInUser = signedInUsers[i];
                            // 不显示当前用户自己
                            if (signedInUser.Id !== user.Id) {
                                items.push({
                                    name: signedInUser.Name,
                                    id: "user-" + signedInUser.Id, // 生成特殊标识符
                                    // 获取用户真实头像，如果没有则使用 null（后续UI会走默认图标）
                                    ImageUrl: signedInUser.PrimaryImageTag
                                        ? apiClient.getUserImageUrl(signedInUser.Id, { maxWidth: 80, type: "Primary", tag: signedInUser.PrimaryImageTag })
                                        : null,
                                    icon: userIcon
                                });
                            }
                        }
                        
                        // 推入普通的“切换用户”（回到选人界面）
                        items.push({
                            name: _globalize.default.translate("HeaderChangeUser"),
                            id: "changeuser",
                            icon: _itemmanager.default.getDefaultIcon({ Type: "User" })
                        });
                    }

                    // 如果允许显示“退出”且没有要求放在第一位，则将其放在靠后的位置
                    if (showExit && !exitFirst) {
                        items.push({
                            name: _globalize.default.translate("Exit"),
                            id: "exit",
                            icon: "&#xe879;"
                        });
                    }

                    // 检查系统级电源功能支持（通常在客户端打包成App时才支持）
                    if (_servicelocator.appHost.supports("sleep")) {
                        items.push({
                            name: _globalize.default.translate("Sleep"),
                            id: "sleep",
                            icon: "&#xe426;"
                        });
                    }

                    if (_servicelocator.appHost.supports("shutdown")) {
                        items.push({
                            name: _globalize.default.translate("Shutdown"),
                            id: "shutdown",
                            icon: "&#xe8AC;"
                        });
                    }

                    if (_servicelocator.appHost.supports("restart")) {
                        items.push({
                            name: _globalize.default.translate("Restart"),
                            id: "restart",
                            icon: "&#xe5D5;"
                        });
                    }

                    return items;
                }

                // 4. 调用 ActionSheet 组件显示菜单
                return _actionsheet.default.show({
                    items: buildMenuItems(options, apiClient, user, signedInUsers),
                    // 定位相关配置（将菜单挂载到点击的按钮附近）
                    positionTo: options.positionTo,
                    positionY: options.positionY,
                    positionX: options.positionX,
                    transformOrigin: options.transformOrigin,
                    // 是否在顶部显示当前用户信息卡片
                    item: options.showUserInfo === false ? null : user,
                    showServerName: true,
                    hasItemIcon: true,
                    hasItemImage: true,
                    roundImage: true,
                    fields: ["Name", "ShortOverview"],
                    text: options.text,
                    // TV 端如果未指定位置，则全屏显示菜单
                    dialogSize: options.positionTo || !_layoutmanager.default.tv ? null : "fullscreen"
                    
                }).then(function (id) {
                    
                    // 5. 根据用户点击菜单项返回的 ID 执行对应操作
                    switch (id) {
                        case "changeuser":
                            _approuter.default.logout(apiClient); // 登出当前用户
                            break;
                        case "home":
                            _approuter.default.goHome(); // 回到主页
                            break;
                        case "exit":
                            _servicelocator.appHost.exit(); // 退出应用
                            break;
                        case "sleep":
                            _servicelocator.appHost.sleep(); // 休眠
                            break;
                        case "shutdown":
                            _servicelocator.appHost.shutdown(); // 关机
                            break;
                        case "restart":
                            _servicelocator.appHost.restart(); // 重启
                            break;
                        case "settings":
                            _approuter.default.showSettings(); // 打开设置页面
                            break;
                        case "manageserver":
                            // 管理服务器逻辑（区分 TV 端和非 TV 端的路由处理）
                            if (_layoutmanager.default.tv) {
                                _approuter.default.showSettings({ start: "server" });
                            } else {
                                _approuter.default.show(_approuter.default.getRouteUrl("manageserver"));
                            }
                            break;
                        case "selectserver":
                            _approuter.default.showSelectServer(); // 切换服务器界面
                            break;
                        default:
                            // 处理快速切换到特定已登录用户的逻辑
                            if (!(id || "").startsWith("user-")) {
                                return Promise.reject(); // 遇到未知ID时拒绝
                            }
                            
                            // 提取用户 ID ("user-xxxxx" 提取后 5 位之后的内容)
                            var userId = id.substring(5);
                            
                            (function (apiClient, userId) {
                                // 调用路由切换用户
                                _approuter.default.changeToUser({ apiClient: apiClient, userId: userId }).catch(function (err) {
                                    // 过滤掉因为路由终止 ("aborterror") 产生的无关紧要的报错
                                    if (((err == null ? void 0 : err.name) || "").toLowerCase() !== "aborterror") {
                                        console.log("error changing to user: " + err);
                                    }
                                });
                            })(apiClient, userId);
                    }
                    
                    // 操作完成，解决 Promise
                    return Promise.resolve();
                });
            });
        });
    };
});