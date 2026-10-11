import Foundation
import Security
import HITLPSurfaceKit

/// The two server entries, kept in the Keychain (never in defaults or the repo).
enum Keychain {
    private static let service = "org.hitlp.surface.servers"
    private static let account = "servers"

    static func loadServers() -> [ServerConfig] {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data,
              let servers = try? JSONDecoder().decode([ServerConfig].self, from: data) else { return [] }
        return servers
    }

    @discardableResult
    static func saveServers(_ servers: [ServerConfig]) -> Bool {
        guard let data = try? JSONEncoder().encode(servers) else { return false }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
    }
}
