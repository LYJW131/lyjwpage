import MediaPlayer
import UIKit

@MainActor
enum SystemMusic {
    static func listenAlong(to live: NowListeningPayload) async throws {
        guard let track = live.music, let songID = live.songId,
              !songID.isEmpty, songID.allSatisfy(\.isNumber) else {
            throw PlaybackError.catalogUnavailable
        }
        #if targetEnvironment(simulator)
        throw PlaybackError.simulator
        #else
        let authorization = await MPMediaLibrary.requestAuthorization()
        guard authorization == .authorized else { throw PlaybackError.permission }
        guard await UIApplication.shared.open(URL(string: "music://")!) else {
            throw PlaybackError.musicUnavailable
        }
        var ids = [songID]
        for id in live.upcomingSongIds where !id.isEmpty && id.allSatisfy(\.isNumber) && !ids.contains(id) {
            ids.append(id)
        }
        let queue = MPMusicPlayerStoreQueueDescriptor(storeIDs: ids)
        queue.startItemID = songID
        queue.setStartTime(track.positionMs(at: .now) / 1000, forItemWithStoreID: songID)
        let player = MPMusicPlayerController.systemMusicPlayer
        player.shuffleMode = .off
        player.repeatMode = track.repeatOne ? .one : .none
        player.openToPlay(queue)
        #endif
    }

    enum PlaybackError: LocalizedError {
        case catalogUnavailable, simulator, permission, musicUnavailable

        var errorDescription: String? {
            switch self {
            case .catalogUnavailable: "This track has no Apple Music catalog ID."
            case .simulator: "Listen Along needs Apple Music on an iPhone. The simulator cannot play Apple Music."
            case .permission: "Allow Media & Apple Music access in Settings to listen along."
            case .musicUnavailable: "Install Apple Music to listen along on this iPhone."
            }
        }
    }
}
