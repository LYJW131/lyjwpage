import XCTest

@MainActor
final class SimulatorTests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
    }

    override func tearDownWithError() throws {
        app.terminate()
        XCUIDevice.shared.orientation = .portrait
    }

    private func launch(local: Bool = true) {
        if local { app.launchEnvironment["LYJWPAGE_API"] = "http://localhost:8790" }
        app.launch()
        XCTAssertTrue(app.buttons["Arrange"].waitForExistence(timeout: 20))
    }

    private func capture(_ name: String) {
        let image = XCTAttachment(screenshot: app.screenshot())
        image.name = name
        image.lifetime = .keepAlways
        add(image)
        let tree = XCTAttachment(string: app.debugDescription)
        tree.name = name + " accessibility"
        tree.lifetime = .keepAlways
        add(tree)
    }

    private func tab(_ name: String) {
        if !app.tabBars.buttons[name].exists {
            app.tabBars.buttons.matching(NSPredicate(format: "value CONTAINS %@", "Collapsed")).firstMatch.tap()
        }
        XCTAssertTrue(app.tabBars.buttons[name].waitForExistence(timeout: 5))
        app.tabBars.buttons[name].tap()
    }

    private func override(_ path: String, body: Data) async throws {
        var request = URLRequest(url: URL(string: "http://localhost:8788/api/dev/override" + path)!)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        let (_, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
    }

    private func fixture(_ path: String, _ name: String) async throws {
        let here = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        let url = here.appending(path: "../../../workers/api/dev-fixtures/" + name + ".json").standardizedFileURL
        var text = try String(contentsOf: url, encoding: .utf8)
        let now = Date().timeIntervalSince1970 * 1000
        text = text.replacing(/"\$now(?<offset>[+-]\d+)?"/) { match in
            String(Int64(now + (match.output.offset.flatMap { Double($0) } ?? 0)))
        }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "Asia/Shanghai")
        formatter.dateFormat = "yyyy-MM-dd"
        text = text.replacing(/\$today(?<offset>[+-]\d+)?/) { match in
            let days = match.output.offset.flatMap { Double($0) } ?? 0
            return formatter.string(from: Date().addingTimeInterval(days * 86400))
        }
        try await override(path, body: Data(text.utf8))
    }

    func testProductionNavigationAndRefresh() {
        launch(local: false)
        XCTAssertTrue(app.staticTexts["Live updates connected"].waitForExistence(timeout: 30))
        app.scrollViews.firstMatch.swipeDown()
        capture("production-now")
        tab("Pulse")
        XCTAssertTrue(app.staticTexts["Timeline"].waitForExistence(timeout: 30))
        capture("production-pulse")
        tab("Library")
        for section in ["Music", "Watching", "Workouts", "Games"] {
            app.segmentedControls.buttons[section].tap()
            XCTAssertTrue(app.navigationBars[section].waitForExistence(timeout: 5))
            capture("production-library-" + section)
        }
        tab("iPhone")
        XCTAssertTrue(app.staticTexts["Last report"].waitForExistence(timeout: 10))
        app.buttons["Report Now"].tap()
        capture("production-iphone-no-configuration")
    }

    func testArrangeVisibilityPersistenceAndReset() {
        launch()
        app.buttons["Arrange"].tap()
        XCTAssertTrue(app.navigationBars["Arrange Cards"].waitForExistence(timeout: 5))
        app.buttons["Reset"].tap()
        let listening = app.switches.matching(NSPredicate(format: "label CONTAINS %@", "Listening")).firstMatch
        XCTAssertTrue(listening.waitForExistence(timeout: 5))
        listening.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap()
        capture("arrange-after-toggle")
        XCTAssertEqual(listening.value as? String, "0")
        capture("arrange-hidden-listening")
        app.buttons["Done"].tap()
        app.terminate()
        launch()
        app.buttons["Arrange"].tap()
        XCTAssertEqual(listening.value as? String, "0")
        app.buttons["Reset"].tap()
        XCTAssertEqual(listening.value as? String, "1")
        let activity = app.switches["Activity"]
        let watching = app.switches.matching(NSPredicate(format: "label CONTAINS %@", "Now Watching")).firstMatch
        activity.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.5))
            .press(forDuration: 1.2, thenDragTo: watching.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.1)))
        XCTAssertLessThan(activity.frame.minY, listening.frame.minY)
        capture("arrange-reordered")
        app.buttons["Reset"].tap()
        app.buttons["Done"].tap()
    }

    func testFixtureCardsPlayerPulseAndWatching() async throws {
        for (path, name) in [
            ("watching/now", "watching-now"), ("charger", "charger-macbook-iphone"),
            ("powerbank", "powerbank-charging"), ("listening/now", "listening-now-yoasobi"),
            ("desktop", "desktop-ghostty"), ("playing/now", "playing-now-pragmata"),
            ("activity", "activity-afternoon"), ("pulse", "pulse-busy-day"), ("workouts", "workouts"),
        ] {
            try await fixture("/api/status/" + path, name)
        }
        launch()
        XCTAssertTrue(app.staticTexts["Now Watching"].waitForExistence(timeout: 20))
        capture("fixtures-now")
        let player = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Now playing:")).firstMatch
        XCTAssertTrue(player.waitForExistence(timeout: 20))
        player.tap()
        XCTAssertTrue(app.buttons["Close"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Listen Along in Apple Music"].exists)
        app.buttons["Listen Along in Apple Music"].tap()
        XCTAssertTrue(app.alerts["Unable to Listen Along"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Listen Along needs Apple Music on an iPhone. The simulator cannot play Apple Music."].exists)
        app.alerts.buttons["OK"].tap()
        capture("fixtures-player-artwork")
        app.buttons["Lyrics"].tap()
        XCTAssertTrue(app.staticTexts["Fixture first line"].waitForExistence(timeout: 10))
        capture("fixtures-player")
        app.buttons["Close"].tap()
        tab("Pulse")
        XCTAssertTrue(app.staticTexts["Tokens / min"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["Steps"].exists)
        let chart = app.descendants(matching: .any).matching(identifier: "pulse.timeline").firstMatch
        XCTAssertTrue(chart.exists)
        chart.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            .press(forDuration: 1, thenDragTo: chart.coordinate(withNormalizedOffset: CGVector(dx: 0.75, dy: 0.5)))
        app.scrollViews.firstMatch.swipeUp()
        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "pulse.moment").firstMatch.exists)
        capture("fixtures-pulse-selection")
        tab("Library")
        app.segmentedControls.buttons["Watching"].tap()
        let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "library.watching.")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 20))
        row.swipeLeft()
        capture("fixtures-watching-after-swipe")
        XCTAssertTrue(app.buttons["Share"].waitForExistence(timeout: 5))
        capture("fixtures-watching-swipe")
        app.buttons["Share"].tap()
        let sharing = app.otherElements["ActivityListView"]
        XCTAssertTrue(sharing.waitForExistence(timeout: 5))
        capture("fixtures-watching-share")
        app.otherElements["PopoverDismissRegion"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap()
        XCTAssertFalse(sharing.exists)
        app.segmentedControls.buttons["Music"].tap()
        app.segmentedControls.buttons["Watching"].tap()
        row.tap()
        XCTAssertTrue(app.links["Open in Emby"].waitForExistence(timeout: 5))
        capture("fixtures-watching-detail")
    }

    func testPlayerLandscapeAndLargeText() async throws {
        try await fixture("/api/status/listening/now", "listening-now-yoasobi")
        launch()
        let player = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Now playing:")).firstMatch
        XCTAssertTrue(player.waitForExistence(timeout: 20))
        player.tap()
        XCTAssertTrue(app.buttons["Close"].waitForExistence(timeout: 5))
        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertTrue(app.buttons["Listen Along in Apple Music"].waitForExistence(timeout: 5))
        capture("player-landscape")
        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        launch()
        XCTAssertTrue(player.waitForExistence(timeout: 20))
        player.tap()
        XCTAssertTrue(app.buttons["Close"].waitForExistence(timeout: 5))
        capture("player-large-text")
        let listen = app.buttons["Listen Along in Apple Music"]
        for _ in 0..<4 where !listen.isHittable { app.scrollViews.firstMatch.swipeUp() }
        XCTAssertTrue(listen.isHittable)
    }

    func testProductionGamingDetailAndLibrary() {
        exerciseGamingNavigation()
    }

    func testGamingNavigationWithLargeText() {
        app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        exerciseGamingNavigation()
    }

    private func exerciseGamingNavigation() {
        launch(local: false)
        tab("Library")
        app.segmentedControls.buttons["Games"].tap()
        XCTAssertTrue(app.navigationBars["Games"].waitForExistence(timeout: 5))
        capture("games-library")
        tab("Now")
        let card = app.descendants(matching: .any).matching(identifier: "now.playstation").firstMatch
        for _ in 0..<7 where !card.isHittable { app.scrollViews.firstMatch.swipeUp() }
        XCTAssertTrue(card.isHittable)
        card.tap()
        XCTAssertTrue(app.navigationBars["PlayStation"].waitForExistence(timeout: 5))
        capture("games-detail")
        app.collectionViews.firstMatch.swipeUp()
        capture("games-detail-scrolled")
        app.navigationBars.buttons["Now"].tap()
        XCTAssertTrue(card.waitForExistence(timeout: 5))
        for _ in 0..<4 where !card.isHittable { app.scrollViews.firstMatch.swipeUp() }
        card.tap()
        XCTAssertTrue(app.navigationBars["PlayStation"].waitForExistence(timeout: 5))
        app.navigationBars.buttons["Now"].tap()
    }

    func testEmptyAndUnavailableStates() async throws {
        try await fixture("/api/status/pulse", "pulse-empty")
        try await fixture("/api/status/charger", "charger-idle")
        for path in ["watching/now", "powerbank", "listening/now"] {
            try await override("/api/status/" + path, body: Data(#"{"ok":false,"error":"E2E unavailable"}"#.utf8))
        }
        launch()
        tab("Pulse")
        XCTAssertTrue(app.staticTexts["Timeline"].waitForExistence(timeout: 20))
        capture("pulse-empty")
        app.terminate()
        try await override("/api/status/pulse", body: Data(#"{"ok":false,"error":"E2E unavailable"}"#.utf8))
        launch()
        tab("Pulse")
        XCTAssertTrue(app.staticTexts["Timeline"].waitForExistence(timeout: 20))
        capture("pulse-cached-during-outage")
    }

    // 软键盘下 ⌘A 不一定全选；原文比输入框宽时点右端只落到可见部分的末尾，所以点末尾、退格、再读值，直到清空
    private func replace(_ field: XCUIElement, with text: String) {
        let end = field.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.5))
        for _ in 0..<4 {
            end.tap()
            if !(field.value(forKey: "hasKeyboardFocus") as? Bool ?? false) { end.tap() }
            let current = field.value as? String ?? ""
            if current.isEmpty || current == field.placeholderValue { break }
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count))
        }
        if !text.isEmpty { field.typeText(text) }
    }

    // 面板收起动画没走完就点 Settings 会被吞掉，输入框消失时动画也未必走完：没弹出就再点
    private func reopenSettings() {
        let endpoint = app.textFields["Endpoint"]
        XCTAssertTrue(endpoint.waitForNonExistence(timeout: 5))
        for _ in 0..<3 {
            app.buttons["Settings"].tap()
            if endpoint.waitForExistence(timeout: 3) { return }
        }
        XCTFail("Settings sheet did not reopen")
    }

    func testSettingsValidationAndSavedEndpoint() {
        launch()
        tab("iPhone")
        app.buttons["Settings"].tap()
        XCTAssertTrue(app.textFields["Endpoint"].waitForExistence(timeout: 5))
        replace(app.textFields["Endpoint"], with: "http://localhost:8788/api/ingest/iphone")
        replace(app.textFields["Client ID"], with: "simulator-test-client")
        replace(app.secureTextFields["Client Secret"], with: "simulator-test-secret")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["The endpoint needs https:// and a host, and both Client ID and Client Secret are required."].waitForExistence(timeout: 5))
        app.buttons["Cancel"].tap()
        reopenSettings()
        XCTAssertEqual(app.textFields["Endpoint"].value as? String, "http://localhost:8788/api/ingest/iphone")
        capture("settings-validation-persistence")
        let endpoint = app.textFields["Endpoint"]
        replace(endpoint, with: "https://example.invalid/api/ingest/iphone")
        app.buttons["Save"].tap()
        reopenSettings()
        XCTAssertEqual(endpoint.value as? String, "https://example.invalid/api/ingest/iphone")
        replace(endpoint, with: "")
        replace(app.textFields["Client ID"], with: "")
        replace(app.secureTextFields["Client Secret"], with: "")
        app.buttons["Save"].tap()
        app.buttons["Cancel"].tap()
    }

    func testLandscapeAndLargeText() {
        app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        launch()
        capture("accessibility-large-text")
        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertTrue(app.buttons["Arrange"].waitForExistence(timeout: 5))
        capture("landscape-large-text")
    }
}
