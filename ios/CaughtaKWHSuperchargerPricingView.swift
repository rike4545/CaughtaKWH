//
//  CaughtaKWHSuperchargerPricingView.swift
//  CaughtaKWH
//
//  Created by Bryan on 2026-05-27.
//
//  Mirrors the web dashboard (src/main.jsx): four tabs (Find chargers, Transparency,
//  System health, Compare), nearby search by location or ZIP, favorites / recents,
//  Tesla-member vs non-Tesla rates, cheapest window, charge-cost estimate, price history,
//  and the same "recent = observed within 2 hours" rule. Styling follows the warm
//  Sprouty-inspired theme in src/sprouty-theme.css.
//
//  Requires NSLocationWhenInUseUsageDescription in Info.plist for "near me".
//

import SwiftUI
import Foundation
import CoreLocation
import Charts

// MARK: - Theme (mirrors CSS tokens in src/sprouty-theme.css)

enum Theme {
    static func dynamic(light: UInt32, dark: UInt32) -> Color {
        Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) })
    }
    static let bg = dynamic(light: 0xF7F3EA, dark: 0x1F2120)
    static let card = dynamic(light: 0xFCFAF5, dark: 0x282A28)
    static let surface = dynamic(light: 0xFFFFFF, dark: 0x2F322F)
    static let ink = dynamic(light: 0x2A2A28, dark: 0xF2EEE4)
    static let muted = dynamic(light: 0x6E6A62, dark: 0xB6B0A3)
    static let line = dynamic(light: 0xE0DBCF, dark: 0x3A3D3A)
    static let brand = dynamic(light: 0xC4633A, dark: 0xE0845A)      // terracotta
    static let brandFill = dynamic(light: 0xD9774B, dark: 0xE0845A)
    static let sage = dynamic(light: 0x4F7A55, dark: 0x9CC3A0)
    static let slate = dynamic(light: 0x55768F, dark: 0x9FBAD0)
    static let hueSage = Color(hex: 0x7FA283)
    static let hueRose = Color(hex: 0xC98E80)
    static let hueLavender = Color(hex: 0xA194B8)
    static let hueSlate = Color(hex: 0x7E9AB2)
    static let hueOchre = Color(hex: 0xD4B478)
}

private extension UIColor {
    convenience init(hex: UInt32) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
    }
}

// MARK: - Models

struct CaughtaKWHStation: Identifiable, Codable, Hashable {
    let id: String
    let name: String
    let city: String?
    let state: String?
    let address: String?
    let url: String?
    let lat: Double?
    let lng: Double?
    let stalls: Int?
    let maxKw: Int?
    let estimatedSiteKw: Int?
    let capacitySource: String?
    let capacityConfidence: String?
    let lastScrapedAt: Date?
    let lastAttemptedAt: Date?
    let lastScrapeBlocked: Bool?
    let lastScrapeHadPrice: Bool?
    let lastScrapeHadAvailability: Bool?
    let lastScrapeResult: String?
    let lastPriceCandidateCount: Int?
    let lastScrapeAttemptCount: Int?
    let otherEVs: Bool?
    let solarCanopy: Bool?
    let battery: Bool?
    let dateOpened: String?
    let facilityName: String?
}

struct CaughtaKWHPrediction: Identifiable, Codable, Hashable {
    var id: String { "\(stationId)-\(membershipType)" }
    let stationId: String
    let membershipType: String
    let latestObservedAt: Date?
    let latestObservedPrice: Double?
    let latestObservationAgeHours: Double?
    let isCurrentPrice: Bool?
    let freshnessLabel: String?
    let confidenceLabel: String?
    let confidenceScore: Int?
    let confidenceSummary: String?
    let sampleCount: Int?
    let volatility: Double?
    let expectedPrice: Double?
    let averageObservedPrice: Double?
    let bestHour: Int?
    let bestMinute: Int?

    /// Same rule as web `isCurrentPrediction`: server flag, else observed within 2 hours.
    var isCurrent: Bool {
        if isCurrentPrice == true { return true }
        guard let hours = latestObservationAgeHours else { return false }
        return hours <= 2
    }

    var bestWindowLabel: String? {
        guard let bestHour else { return nil }
        return String(format: "%02d:%02d", bestHour, (bestMinute ?? 0) >= 30 ? 30 : 0)
    }
}

struct CaughtaKWHHistoryObservation: Identifiable, Codable, Hashable {
    var id: String { "\(stationId)-\(capturedAt?.timeIntervalSince1970 ?? 0)" }
    let stationId: String
    let capturedAt: Date?
    let memberPricePerKwh: Double?
    let nonMemberPricePerKwh: Double?
    let memberPeakPricePerKwh: Double?
    let nonMemberPeakPricePerKwh: Double?
    let congestionFeePerMinuteMax: Double?
    let availableStalls: Int?
    let totalStalls: Int?
    let utilizationPct: Double?
    let availabilityLabel: String?
}

enum RateType: String, CaseIterable, Identifiable {
    case member, nonMember = "non_member"
    var id: String { rawValue }
    var label: String { self == .member ? "Tesla / member" : "Non-Tesla" }
}

struct BatteryPreset: Identifiable, Hashable {
    let id: String
    let label: String
    let usableKwh: Double
    static let all: [BatteryPreset] = [
        .init(id: "m3-rwd", label: "Model 3 RWD (LFP)", usableKwh: 57.5),
        .init(id: "m3-lr", label: "Model 3 Long Range / Performance", usableKwh: 75),
        .init(id: "my-rwd", label: "Model Y RWD (LFP)", usableKwh: 60),
        .init(id: "my-lr", label: "Model Y Long Range / Performance", usableKwh: 75),
        .init(id: "ms", label: "Model S", usableKwh: 95),
        .init(id: "mx", label: "Model X", usableKwh: 94),
        .init(id: "ct", label: "Cybertruck", usableKwh: 123)
    ]
}

// MARK: - Location

@MainActor
final class LocationProvider: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published var coordinate: CLLocationCoordinate2D?
    @Published var isLocating = false
    @Published var errorMessage: String?
    private let manager = CLLocationManager()

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    func request() {
        errorMessage = nil
        isLocating = true
        switch manager.authorizationStatus {
        case .denied, .restricted:
            isLocating = false
            errorMessage = "Location permission is off. Enable it in Settings or search by ZIP."
        default:
            manager.requestWhenInUseAuthorization()
            manager.requestLocation()
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let coordinate = locations.last?.coordinate
        Task { @MainActor in
            self.coordinate = coordinate
            self.isLocating = false
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let message = error.localizedDescription
        Task { @MainActor in
            self.errorMessage = message
            self.isLocating = false
        }
    }
}

// MARK: - Data Service

@MainActor
final class CaughtaKWHStationPricingStore: ObservableObject {
    @Published var stations: [CaughtaKWHStation] = []
    @Published var predictions: [CaughtaKWHPrediction] = []
    @Published var history: [CaughtaKWHHistoryObservation] = []
    @Published var selectedStationID: String = "LakeGroveNYsupercharger"
    @Published var rateType: RateType = .member
    @Published var origin: CLLocationCoordinate2D?
    @Published var originLabel = ""
    @Published var zipError: String?
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var favorites: [String] = UserDefaults.standard.stringArray(forKey: "caughtakwh:favorites") ?? []
    @Published var recents: [String] = UserDefaults.standard.stringArray(forKey: "caughtakwh:recents") ?? []
    @Published var comparison: [String] = UserDefaults.standard.stringArray(forKey: "caughtakwh:comparison") ?? []

    private let baseURL = URL(string: "https://rike4545.github.io/CaughtaKWH/data")!
    private let decoder: JSONDecoder = {
        // The data files use fractional-second ISO-8601 ("…23:08:50.726Z"), which the plain
        // `.iso8601` strategy rejects, so accept both forms.
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let raw = try decoder.singleValueContainer().decode(String.self)
            let fractional = ISO8601DateFormatter()
            fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = fractional.date(from: raw) { return date }
            if let date = ISO8601DateFormatter().date(from: raw) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unrecognized date: \(raw)"))
        }
        return decoder
    }()

    var selectedStation: CaughtaKWHStation? {
        stations.first(where: { $0.id == selectedStationID }) ?? stations.first
    }

    func prediction(for stationID: String, type: RateType? = nil) -> CaughtaKWHPrediction? {
        let wanted = (type ?? rateType).rawValue
        return predictions.first(where: { $0.stationId == stationID && $0.membershipType == wanted })
            ?? predictions.first(where: { $0.stationId == stationID })
    }

    var selectedPrediction: CaughtaKWHPrediction? {
        guard let id = selectedStation?.id else { return nil }
        return prediction(for: id)
    }

    var latestHistory: CaughtaKWHHistoryObservation? {
        history.sorted { ($0.capturedAt ?? .distantPast) < ($1.capturedAt ?? .distantPast) }.last
    }

    func station(_ id: String) -> CaughtaKWHStation? { stations.first(where: { $0.id == id }) }

    func distanceMiles(to station: CaughtaKWHStation) -> Double? {
        guard let origin, let lat = station.lat, let lng = station.lng else { return nil }
        let meters = CLLocation(latitude: origin.latitude, longitude: origin.longitude)
            .distance(from: CLLocation(latitude: lat, longitude: lng))
        return meters / 1609.344
    }

    func nearby(limit: Int = 5) -> [CaughtaKWHStation] {
        guard origin != nil else { return [] }
        return stations
            .compactMap { station -> (CaughtaKWHStation, Double)? in
                guard let miles = distanceMiles(to: station) else { return nil }
                return (station, miles)
            }
            .sorted { $0.1 < $1.1 }
            .prefix(limit)
            .map { $0.0 }
    }

    func setOrigin(_ coordinate: CLLocationCoordinate2D, label: String) {
        origin = coordinate
        originLabel = label
        if let closest = nearby(limit: 1).first { select(closest.id) }
    }

    func lookupZip(_ zip: String) async {
        zipError = nil
        let cleaned = zip.filter(\.isNumber).prefix(5)
        guard cleaned.count == 5, let url = URL(string: "https://api.zippopotam.us/us/\(cleaned)") else {
            zipError = "Enter a valid 5-digit ZIP code."
            return
        }
        struct Zip: Decodable {
            struct Place: Decodable { let latitude: String; let longitude: String; let state: String
                enum CodingKeys: String, CodingKey { case latitude, longitude, state = "state abbreviation" } }
            let places: [Place]
        }
        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            guard (response as? HTTPURLResponse)?.statusCode == 200,
                  let place = try JSONDecoder().decode(Zip.self, from: data).places.first,
                  let lat = Double(place.latitude), let lng = Double(place.longitude) else {
                zipError = "ZIP code not found."
                return
            }
            setOrigin(CLLocationCoordinate2D(latitude: lat, longitude: lng), label: "ZIP \(cleaned)")
        } catch {
            zipError = "ZIP lookup failed."
        }
    }

    func select(_ id: String) {
        selectedStationID = id
        recents = Array(([id] + recents.filter { $0 != id }).prefix(8))
        save(recents, key: "caughtakwh:recents")
        Task { await loadHistoryForSelectedStation() }
    }

    func toggleFavorite(_ id: String) {
        favorites = favorites.contains(id) ? favorites.filter { $0 != id } : Array(([id] + favorites).prefix(20))
        save(favorites, key: "caughtakwh:favorites")
    }

    func toggleComparison(_ id: String) {
        comparison = comparison.contains(id) ? comparison.filter { $0 != id } : Array(([id] + comparison).prefix(4))
        save(comparison, key: "caughtakwh:comparison")
    }

    func clearRecents() { recents = []; save(recents, key: "caughtakwh:recents") }

    private func save(_ values: [String], key: String) { UserDefaults.standard.set(values, forKey: key) }

    func load() async {
        isLoading = true
        errorMessage = nil
        do {
            async let stationRows: [CaughtaKWHStation] = fetch("stations.json")
            async let predictionRows: [CaughtaKWHPrediction] = fetch("predictions.json")
            stations = try await stationRows
            predictions = try await predictionRows
            if station(selectedStationID) == nil, let first = stations.first { selectedStationID = first.id }
            await loadHistoryForSelectedStation()
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    func loadHistoryForSelectedStation() async {
        guard let stationID = selectedStation?.id else { return }
        do {
            history = try await fetch("history/\(stationID).json")
        } catch {
            history = []
        }
    }

    private func fetch<T: Decodable>(_ path: String) async throws -> T {
        let url = baseURL.appending(path: path)
        let (data, response) = try await URLSession.shared.data(from: url)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return try decoder.decode(T.self, from: data)
    }
}

// MARK: - Root

struct CaughtaKWHSuperchargerPricingView: View {
    @StateObject private var store = CaughtaKWHStationPricingStore()
    @StateObject private var location = LocationProvider()
    @State private var tab = 0

    var body: some View {
        TabView(selection: $tab) {
            ChargersTab(store: store, location: location, goCompare: { tab = 3 })
                .tabItem { Label("Find chargers", systemImage: "magnifyingglass") }.tag(0)
            TransparencyTab(store: store)
                .tabItem { Label("Transparency", systemImage: "eye") }.tag(1)
            HealthTab(store: store)
                .tabItem { Label("System health", systemImage: "waveform.path.ecg") }.tag(2)
            CompareTab(store: store, openStation: { id in store.select(id); tab = 0 })
                .tabItem { Label("Compare", systemImage: "scalemass") }.tag(3)
                .badge(store.comparison.count)
        }
        .tint(Theme.brand)
        .task { await store.load() }
        .onChange(of: location.coordinate?.latitude) { _, _ in
            if let coordinate = location.coordinate { store.setOrigin(coordinate, label: "your location") }
        }
    }
}

// MARK: - Shared helpers & components

private func currency(_ value: Double?) -> String {
    guard let value else { return "—" }
    return value.formatted(.currency(code: "USD"))
}

private func ageText(_ hours: Double?) -> String {
    guard let hours else { return "No public price yet" }
    if hours < 1 { return "\(Int((hours * 60).rounded())) min old" }
    return "\(hours.formatted(.number.precision(.fractionLength(hours < 10 ? 1 : 0)))) hr old"
}

private func freshnessText(_ prediction: CaughtaKWHPrediction?) -> String {
    guard let hours = prediction?.latestObservationAgeHours, prediction?.latestObservedAt != nil else { return "No price captured" }
    if hours < 0.5 { return "Fresh, under 30 min" }
    if hours < 2 { return "Recent, under 2 hr" }
    if hours < 24 { return "Getting old, over 2 hr" }
    return "Old, over 24 hr"
}

private func shortDate(_ date: Date?) -> String {
    guard let date else { return "—" }
    return date.formatted(date: .abbreviated, time: .shortened)
}

private func titleCase(_ value: String?) -> String {
    (value ?? "—").replacingOccurrences(of: "_", with: " ").capitalized
}

enum MascotMood { case idle, happy, sleepy, thirsty, searching }

/// Pixel-art "Volt" plug mascot — same sprite as src/components/Mascot.jsx.
struct Mascot: View {
    var mood: MascotMood = .idle
    var size: CGFloat = 56

    private static let head = [".....YY.....", "....YY......", "...YYYY.....", "..BBBBBBBB..", ".BBBBBBBBBB."]
    private static let feet = ["..BBBBBBBB..", "...P....P...", "...P....P..."]

    private var face: [String] {
        switch mood {
        case .happy: return [".BBDBBBBDBB.", ".BBBDBBDBBB.", ".BBBBBBBBBB.", ".BBDDDDDDBB."]
        case .sleepy: return [".BBBBBBBBBB.", ".BBDDBBDDBB.", ".BBBBBBBBBB.", ".BBBBDDBBBB."]
        case .thirsty: return [".BBDBBBBDBB.", ".BBBBBBBBBB.", ".BBBBBBBBBB.", ".BBBDDDDBBB."]
        case .searching: return [".BBBDBBBDBB.", ".BBBDBBBDBB.", ".BBBBBBBBBB.", ".BBBBDDBBBB."]
        case .idle: return [".BBDBBBBDBB.", ".BBBBBBBBBB.", ".BBDBBBBDBB.", ".BBBDDDDBBB."]
        }
    }

    var body: some View {
        let rows = (Self.head + face + Self.feet).map { Array($0) }
        Canvas { context, canvasSize in
            let cell = canvasSize.width / 12
            for (y, row) in rows.enumerated() {
                for (x, ch) in row.enumerated() {
                    var glyph = ch
                    if mood == .thirsty && x == 10 && (y == 4 || y == 5) { glyph = "S" }
                    if mood == .happy && ((y == 1 && x == 8) || (y == 0 && x == 9) || (y == 2 && x == 10)) { glyph = "Y" }
                    let color: Color
                    switch glyph {
                    case "B": color = Theme.brandFill
                    case "Y": color = Theme.hueOchre
                    case "S": color = Theme.hueSlate
                    case "D", "P": color = Color(hex: 0x2A2A28)
                    default: continue
                    }
                    context.fill(Path(CGRect(x: CGFloat(x) * cell, y: CGFloat(y) * cell, width: cell + 0.5, height: cell + 0.5)), with: .color(color))
                }
            }
        }
        .frame(width: size, height: size * CGFloat(rows.count) / 12)
        .accessibilityHidden(true)
    }
}

extension View {
    /// Flat card: hairline border, ~20pt radius, optional muted hue tint (Sprouty style).
    func cardStyle(tint: Color? = nil) -> some View {
        self
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(Theme.card)
                    .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).fill((tint ?? .clear).opacity(0.22)))
            )
            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(Theme.line, lineWidth: 1))
    }
}

private struct SectionHeader: View {
    let eyebrow: String
    let title: String
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(eyebrow).font(.caption.weight(.heavy)).textCase(.uppercase).foregroundStyle(Theme.brand)
            Text(title).font(.title3.weight(.heavy)).foregroundStyle(Theme.ink)
        }
    }
}

private struct StatTile: View {
    let title: String
    let value: String
    let note: String
    let tint: Color
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption).foregroundStyle(Theme.muted)
            Text(value).font(.title2.weight(.heavy)).foregroundStyle(Theme.ink).monospacedDigit().minimumScaleFactor(0.7).lineLimit(1)
            Text(note).font(.caption2).foregroundStyle(Theme.muted).lineLimit(2)
        }
        .cardStyle(tint: tint)
    }
}

private struct DetailColumn: View {
    let title: String
    let value: String
    init(_ title: String, _ value: String) { self.title = title; self.value = value }
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title).font(.caption).foregroundStyle(Theme.muted)
            Text(value).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink).lineLimit(2).minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct WarningCard: View {
    let title: String
    let message: String
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Mascot(mood: .thirsty, size: 40)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.headline).foregroundStyle(Theme.ink)
                Text(message).font(.callout).foregroundStyle(Theme.muted)
            }
        }
        .cardStyle(tint: Theme.hueOchre)
    }
}

private struct StationRow: View {
    let station: CaughtaKWHStation
    let price: Double?
    let miles: Double?
    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(station.name).font(.subheadline.weight(.bold)).foregroundStyle(Theme.ink).lineLimit(1)
                Text([miles.map { String(format: "%.1f mi", $0) }, station.address ?? [station.city, station.state].compactMap { $0 }.joined(separator: ", ")]
                        .compactMap { $0 }.joined(separator: " • "))
                    .font(.caption).foregroundStyle(Theme.muted).lineLimit(1)
            }
            Spacer()
            if let price { Text(currency(price)).font(.subheadline.weight(.heavy)).foregroundStyle(Theme.sage).monospacedDigit() }
        }
        .padding(.vertical, 6)
    }
}

// MARK: - Chargers tab

private struct ChargersTab: View {
    @ObservedObject var store: CaughtaKWHStationPricingStore
    @ObservedObject var location: LocationProvider
    var goCompare: () -> Void
    @State private var searchText = ""
    @State private var zip = ""

    private var results: [CaughtaKWHStation] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if !query.isEmpty {
            return store.stations.filter { station in
                [station.name, station.city, station.state, station.address, station.id]
                    .compactMap { $0 }.joined(separator: " ").lowercased().contains(query)
            }.prefix(50).map { $0 }
        }
        return store.nearby(limit: 5)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    hero
                    findCard
                    savedCard
                    if let message = store.errorMessage {
                        WarningCard(title: "Could not load data", message: message)
                    }
                    if !results.isEmpty { resultsCard }
                    if let station = store.selectedStation {
                        StationDetail(store: store, station: station, goCompare: goCompare)
                    } else if store.isLoading {
                        ProgressView("Loading CaughtaKWH data…").frame(maxWidth: .infinity).padding(.vertical, 40)
                    }
                    SupportCard()
                }
                .padding(16)
            }
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle("CaughtaKWH")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $searchText, prompt: "Search station, city, state…")
            .refreshable { await store.load() }
        }
    }

    private var hero: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 8) {
                Label("Supercharger price transparency", systemImage: "bolt.fill")
                    .font(.caption.weight(.heavy)).textCase(.uppercase).foregroundStyle(Theme.brand)
                (Text("Know the ") + Text("real price").foregroundColor(Theme.brand) + Text(" before you plug in."))
                    .font(.largeTitle.weight(.heavy)).foregroundStyle(Theme.ink).minimumScaleFactor(0.7)
                Text("Tesla’s app or your car is still the live price; CaughtaKWH separates fresh public prices from saved history.")
                    .font(.callout).foregroundStyle(Theme.muted)
            }
            Mascot(mood: .idle, size: 52)
        }
    }

    private var findCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button {
                location.request()
            } label: {
                Label(location.isLocating ? "Finding…" : "Find chargers near me", systemImage: "location.fill")
                    .font(.headline).foregroundStyle(Color(hex: 0x2A2A28))
                    .frame(maxWidth: .infinity).padding(.vertical, 13)
                    .background(Theme.brandFill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .disabled(location.isLocating)
            HStack {
                TextField("ZIP code", text: $zip)
                    .keyboardType(.numberPad).textContentType(.postalCode)
                    .padding(.horizontal, 12).padding(.vertical, 11)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Theme.line))
                Button("Find 5") { Task { await store.lookupZip(zip) } }
                    .font(.headline).foregroundStyle(Theme.brand)
            }
            if let error = store.zipError ?? location.errorMessage {
                Text(error).font(.caption).foregroundStyle(Theme.brand)
            } else if !store.originLabel.isEmpty {
                Text("Showing the 5 closest chargers to \(store.originLabel).").font(.caption).foregroundStyle(Theme.muted)
            }
        }
        .cardStyle()
    }

    @ViewBuilder private var savedCard: some View {
        let favorites = store.favorites.compactMap { store.station($0) }.prefix(4)
        let recents = store.recents.compactMap { store.station($0) }.prefix(4)
        if !favorites.isEmpty || !recents.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                if !favorites.isEmpty {
                    Label("Favorites", systemImage: "heart.fill").font(.caption.weight(.heavy)).foregroundStyle(Theme.brand)
                    ForEach(Array(favorites)) { station in
                        Button { store.select(station.id) } label: { StationRow(station: station, price: nil, miles: store.distanceMiles(to: station)) }
                    }
                }
                if !recents.isEmpty {
                    HStack {
                        Label("Recently viewed", systemImage: "clock").font(.caption.weight(.heavy)).foregroundStyle(Theme.muted)
                        Spacer()
                        Button("Clear") { store.clearRecents() }.font(.caption)
                    }
                    ForEach(Array(recents)) { station in
                        Button { store.select(station.id) } label: { StationRow(station: station, price: nil, miles: store.distanceMiles(to: station)) }
                    }
                }
            }
            .cardStyle()
        }
    }

    private var resultsCard: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(searchText.isEmpty ? "Nearby chargers" : "\(results.count) matching chargers")
                .font(.caption.weight(.heavy)).textCase(.uppercase).foregroundStyle(Theme.muted)
            ForEach(results) { station in
                let prediction = store.prediction(for: station.id, type: .member)
                Button { store.select(station.id) } label: {
                    StationRow(station: station,
                               price: (prediction?.isCurrent == true) ? prediction?.latestObservedPrice : nil,
                               miles: store.distanceMiles(to: station))
                }
                Divider().overlay(Theme.line)
            }
        }
        .cardStyle()
    }
}

// MARK: - Station detail

private struct StationDetail: View {
    @ObservedObject var store: CaughtaKWHStationPricingStore
    let station: CaughtaKWHStation
    var goCompare: () -> Void
    private let supportReport = URL(string: "https://github.com/rike4545/CaughtaKWH/issues/new?template=price-report.yml")!

    private var prediction: CaughtaKWHPrediction? { store.prediction(for: station.id) }
    private var latest: CaughtaKWHHistoryObservation? { store.latestHistory }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            truthCard
            headerCard
            priceMatrix
            insights
            capacityCard
            CostCalculator(
                currentPrice: currentRate,
                cheapestPrice: prediction?.expectedPrice,
                cheapestLabel: prediction?.bestWindowLabel,
                rateLabel: store.rateType.label,
                fresh: prediction?.isCurrent == true
            )
            HistoryChart(rows: store.history)
            if prediction?.isCurrent != true, let prediction, prediction.latestObservedAt != nil {
                WarningCard(
                    title: (prediction.latestObservationAgeHours ?? 0) > 48 ? "Very stale pricing" : "Stale pricing",
                    message: "The last historical price was observed \(ageText(prediction.latestObservationAgeHours)). Keep it for trend context, but do not treat it as current Tesla pricing."
                )
            }
        }
    }

    private var currentRate: Double? {
        let observed = store.rateType == .member ? latest?.memberPricePerKwh : latest?.nonMemberPricePerKwh
        return observed ?? (prediction?.isCurrent == true ? prediction?.latestObservedPrice : nil) ?? prediction?.averageObservedPrice
    }

    private struct TruthState { let title: String; let message: String; let mood: MascotMood; let good: Bool }

    private var truth: TruthState {
        if let prediction, prediction.latestObservedAt != nil {
            if prediction.isCurrent {
                return .init(title: "Recent Tesla public price observed",
                             message: "\(currency(prediction.latestObservedPrice)) · \(ageText(prediction.latestObservationAgeHours)). Treat this as recently observed, but still verify in Tesla before charging.",
                             mood: .happy, good: true)
            }
            return .init(title: "Stale historical price only",
                         message: "\(currency(prediction.latestObservedPrice)) last observed \(shortDate(prediction.latestObservedAt)). Older than 2 hours, so it is kept as history, not shown as the current Tesla price.",
                         mood: .sleepy, good: false)
        }
        if station.lastScrapeBlocked == true {
            return .init(title: "Tesla blocked the automated check", message: "CaughtaKWH preserved prior data and will retry later.", mood: .thirsty, good: false)
        }
        if station.lastScrapeResult == "transient_failure" {
            return .init(title: "Temporary connection problem", message: "The last attempt could not reliably reach Tesla; prior data was preserved.", mood: .thirsty, good: false)
        }
        if station.lastScrapeHadAvailability == true {
            return .init(title: "Tesla shows the site, but not the price", message: "The station page had availability info, but no public $/kWh rate.", mood: .thirsty, good: false)
        }
        if station.lastScrapedAt != nil {
            return .init(title: "No price on the public page yet", message: "Last checked \(shortDate(station.lastScrapedAt)). The live rate may only be visible in the Tesla app or inside the car.", mood: .thirsty, good: false)
        }
        return .init(title: "We have not checked this one yet", message: "Until the scraper gets a clean look at this station, use Tesla for the live price.", mood: .searching, good: false)
    }

    private var truthCard: some View {
        let state = truth
        return HStack(spacing: 14) {
            Mascot(mood: state.mood, size: 48)
            VStack(alignment: .leading, spacing: 4) {
                Text(state.title).font(.headline).foregroundStyle(Theme.ink)
                Text(state.message).font(.callout).foregroundStyle(Theme.muted)
            }
        }
        .cardStyle(tint: state.good ? Theme.hueSage : Theme.hueOchre)
    }

    private var headerCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(eyebrow: "Selected charger", title: station.name)
            if let address = station.address { Text(address).font(.callout).foregroundStyle(Theme.muted) }
            HStack(spacing: 8) {
                if let stalls = station.stalls { chip("\(stalls) stalls", "battery.100.bolt") }
                if let kw = station.maxKw { chip("Up to \(kw) kW", "bolt.fill") }
                chip(freshnessText(prediction), "clock")
            }
            .font(.caption.weight(.semibold))
            HStack(spacing: 8) {
                actionButton(store.favorites.contains(station.id) ? "Favorited" : "Favorite", store.favorites.contains(station.id) ? "heart.fill" : "heart", active: store.favorites.contains(station.id)) {
                    store.toggleFavorite(station.id)
                }
                actionButton(store.comparison.contains(station.id) ? "In compare" : "Compare", "scalemass", active: store.comparison.contains(station.id)) {
                    store.toggleComparison(station.id)
                }
            }
            HStack(spacing: 14) {
                if let urlString = station.url, let url = URL(string: urlString) { Link("Open Tesla page", destination: url) }
                Link("Report a price", destination: supportReport)
            }
            .font(.callout.weight(.semibold)).tint(Theme.brand)
            Picker("Rate", selection: $store.rateType) {
                ForEach(RateType.allCases) { Text($0.label).tag($0) }
            }
            .pickerStyle(.segmented)
        }
        .cardStyle()
    }

    private func chip(_ text: String, _ symbol: String) -> some View {
        Label(text, systemImage: symbol)
            .padding(.horizontal, 10).padding(.vertical, 5)
            .background(Theme.surface, in: Capsule())
            .overlay(Capsule().stroke(Theme.line))
            .foregroundStyle(Theme.muted)
    }

    private func actionButton(_ title: String, _ symbol: String, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: symbol).font(.subheadline.weight(.bold))
                .frame(maxWidth: .infinity).padding(.vertical, 10)
                .background(active ? Theme.brand.opacity(0.18) : Theme.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(active ? Theme.brand : Theme.line))
                .foregroundStyle(Theme.ink)
        }
    }

    private var priceMatrix: some View {
        let fresh = prediction?.isCurrent == true
        let memberOff = latest?.memberPricePerKwh ?? (fresh ? store.prediction(for: station.id, type: .member)?.latestObservedPrice : nil)
        return VStack(spacing: 10) {
            HStack(spacing: 10) {
                rateTile("Tesla / member", off: memberOff, peak: latest?.memberPeakPricePerKwh, tint: Theme.hueSage, color: Theme.sage, fresh: fresh)
                rateTile("Non-Tesla", off: latest?.nonMemberPricePerKwh, peak: latest?.nonMemberPeakPricePerKwh, tint: Theme.hueSlate, color: Theme.slate, fresh: fresh)
            }
            HStack {
                Label("Congestion fee \(latest?.congestionFeePerMinuteMax.map { currency($0) + "/min" } ?? "none shown")", systemImage: "clock")
                Spacer()
                Text(fresh ? "Recently observed" : prediction?.latestObservedAt != nil ? "Historical only" : "Not checked yet")
                    .foregroundStyle(fresh ? Theme.sage : Theme.muted)
            }
            .font(.caption).foregroundStyle(Theme.muted)
        }
        .cardStyle()
    }

    private func rateTile(_ label: String, off: Double?, peak: Double?, tint: Color, color: Color, fresh: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption.weight(.heavy)).textCase(.uppercase).foregroundStyle(Theme.muted)
            if let off {
                Text(currency(off)).font(.system(size: 30, weight: .heavy)).monospacedDigit().foregroundStyle(fresh ? color : Theme.ink)
                Text(peak.map { "to \(currency($0)) at peak" } ?? "flat rate, all day").font(.caption2).foregroundStyle(Theme.muted)
            } else {
                Text("Hidden").font(.title3.weight(.heavy)).foregroundStyle(Theme.muted)
                Text("no public rate shown").font(.caption2).foregroundStyle(Theme.muted)
            }
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.surface)
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(tint.opacity(fresh && off != nil ? 0.22 : 0))))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Theme.line))
    }

    private var insights: some View {
        HStack(spacing: 10) {
            StatTile(title: "Cheapest charging window", value: prediction?.bestWindowLabel ?? "—",
                     note: prediction?.bestWindowLabel != nil ? "lowest expected $/kWh across the day" : "needs more price history", tint: Theme.hueSage)
            StatTile(title: "How much to trust it", value: prediction?.isCurrent == true ? (prediction?.confidenceLabel?.capitalized ?? "Low") : "Low",
                     note: "\(prediction?.confidenceScore.map { "\($0)/100" } ?? "no score") · \(prediction?.sampleCount.map { "\($0) samples" } ?? "no samples")", tint: Theme.hueLavender)
        }
    }

    private var capacityCard: some View {
        let total = latest?.totalStalls ?? station.stalls
        let theoretical = station.estimatedSiteKw ?? ((total != nil && station.maxKw != nil) ? total! * station.maxKw! : nil)
        return VStack(alignment: .leading, spacing: 12) {
            SectionHeader(eyebrow: "Charger details", title: "Capacity & checks")
            HStack {
                DetailColumn("Available now", latest?.availableStalls.map { "\($0) of \(total ?? $0)" } ?? "Not visible")
                DetailColumn("Utilization", latest?.utilizationPct.map { "\(Int(($0 * 100).rounded()))%" } ?? "Not visible")
            }
            HStack {
                DetailColumn("Theoretical output", theoretical.map { "\($0.formatted()) kW" } ?? "Unknown")
                DetailColumn("Latest page check", scrapeResultText)
            }
            HStack {
                DetailColumn("Last attempt", shortDate(station.lastAttemptedAt ?? station.lastScrapedAt))
                DetailColumn("Price-like numbers", station.lastPriceCandidateCount.map(String.init) ?? "—")
            }
            let tags = [station.otherEVs == true ? "Open to non-Tesla EVs" : nil, station.solarCanopy == true ? "Solar canopy" : nil, station.battery == true ? "On-site battery" : nil].compactMap { $0 }
            if !tags.isEmpty {
                Text(tags.joined(separator: " · ")).font(.caption.weight(.semibold)).foregroundStyle(Theme.sage)
            }
        }
        .cardStyle()
    }

    private var scrapeResultText: String {
        switch station.lastScrapeResult {
        case "price_found": return "Price found"
        case "availability_found": return "Availability found"
        case "valid_page_no_public_data": return "Page loaded, price hidden"
        case "access_controlled": return "Access controlled"
        case "transient_failure": return "Temporary connection problem"
        case "no_usable_candidate": return "Station page not confirmed"
        default: return station.lastScrapedAt == nil ? "Not checked" : titleCase(station.lastScrapeResult)
        }
    }
}

// MARK: - Cost calculator (mirrors src/chargeCost.js)

private struct CostCalculator: View {
    let currentPrice: Double?
    let cheapestPrice: Double?
    let cheapestLabel: String?
    let rateLabel: String
    let fresh: Bool
    @State private var preset = BatteryPreset.all[1]
    @State private var arrival = 40.0
    @State private var target = 80.0

    private func cost(_ price: Double?) -> (kwh: Double, cost: Double)? {
        guard let price, price > 0 else { return nil }
        let kwh = max(0, target - arrival) / 100 * preset.usableKwh
        return (kwh, kwh * price)
    }

    var body: some View {
        let now = cost(currentPrice)
        let best = cost(cheapestPrice)
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(eyebrow: "Cost to charge", title: now.map { "≈ \(currency($0.cost)) to \(Int(target))%" } ?? "Estimate your session cost")
            Picker("Vehicle", selection: $preset) {
                ForEach(BatteryPreset.all) { Text("\($0.label) · \($0.usableKwh.formatted()) kWh").tag($0) }
            }
            .tint(Theme.brand)
            VStack(alignment: .leading) {
                Text("Arrive at \(Int(arrival))%").font(.caption).foregroundStyle(Theme.muted)
                Slider(value: $arrival, in: 0...100, step: 5).tint(Theme.brand)
                Text("Charge to \(Int(target))%").font(.caption).foregroundStyle(Theme.muted)
                Slider(value: $target, in: 0...100, step: 5).tint(Theme.brand)
            }
            HStack {
                DetailColumn("Estimated cost (\(fresh ? "latest" : "history"))", now.map { "\(currency($0.cost)) · \($0.kwh.formatted(.number.precision(.fractionLength(1)))) kWh" } ?? "No price yet")
                DetailColumn("At cheapest window\(cheapestLabel.map { " (\($0))" } ?? "")", best.map { b in
                    let saving = now.map { max(0, $0.cost - b.cost) }
                    return "\(currency(b.cost))" + ((saving ?? 0) > 0 ? " · save \(currency(saving))" : "")
                } ?? "—")
            }
            Text("Using the \(rateLabel.lowercased()) rate. Real sessions vary with charging speed and temperature — always confirm the live rate in Tesla.")
                .font(.caption2).foregroundStyle(Theme.muted)
        }
        .cardStyle(tint: Theme.hueSlate)
    }
}

// MARK: - History chart

private struct HistoryChart: View {
    let rows: [CaughtaKWHHistoryObservation]

    private struct Point: Identifiable { let id = UUID(); let date: Date; let price: Double; let series: String }

    private var points: [Point] {
        rows.suffix(120).flatMap { row -> [Point] in
            guard let date = row.capturedAt else { return [] }
            return [row.memberPricePerKwh.map { Point(date: date, price: $0, series: "Tesla / member") },
                    row.nonMemberPricePerKwh.map { Point(date: date, price: $0, series: "Non-Tesla") }].compactMap { $0 }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(eyebrow: "Price history", title: points.isEmpty ? "No saved prices yet" : "\(rows.count) recent checks")
            if points.isEmpty {
                HStack(spacing: 12) {
                    Mascot(mood: .searching, size: 40)
                    Text("Once CaughtaKWH sees a public price here, the trend shows up in this chart.").font(.callout).foregroundStyle(Theme.muted)
                }
            } else {
                Chart(points) { point in
                    LineMark(x: .value("Date", point.date), y: .value("$/kWh", point.price))
                        .foregroundStyle(by: .value("Rate", point.series))
                        .interpolationMethod(.stepEnd)
                }
                .chartForegroundStyleScale(["Tesla / member": Theme.sage, "Non-Tesla": Theme.slate])
                .chartYAxis { AxisMarks(format: .currency(code: "USD")) }
                .frame(height: 190)
            }
        }
        .cardStyle()
    }
}

// MARK: - Transparency tab

private struct TransparencyTab: View {
    @ObservedObject var store: CaughtaKWHStationPricingStore
    private let reportURL = URL(string: "https://github.com/rike4545/CaughtaKWH/issues/new?template=price-report.yml")!

    var body: some View {
        let total = store.stations.count
        let priced = Set(store.predictions.map(\.stationId)).count
        let darkPct = total == 0 ? 100 : Int((Double(total - priced) / Double(total) * 100).rounded())
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    VStack(alignment: .leading, spacing: 8) {
                        SectionHeader(eyebrow: "Pricing transparency", title: "How much of the network is publicly priced?")
                        Text("Gas stations post pump prices by law in most states. There is currently no federal requirement for EV charging price display, so most Supercharger prices stay hidden until you arrive.")
                            .font(.callout).foregroundStyle(Theme.muted)
                    }
                    .cardStyle()
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                        StatTile(title: "No public price on record", value: "\(darkPct)%", note: "stations never shown publicly", tint: Theme.hueRose)
                        StatTile(title: "Public price observed", value: "\(100 - darkPct)%", note: "stations with a captured price", tint: Theme.hueSage)
                        StatTile(title: "US stations tracked", value: total.formatted(), note: "Supercharger directory", tint: Theme.hueSlate)
                        StatTile(title: "Stations with a price", value: priced.formatted(), note: "at least one capture", tint: Theme.hueOchre)
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 12) {
                            Mascot(mood: .happy, size: 44)
                            SectionHeader(eyebrow: "Help grow the record", title: "Saw a price? Report it.")
                        }
                        Text("Include the station, the Tesla/member price, the non-Tesla price if shown, the date and time, and where you saw it. Reports are reviewed before being added; no personal information is collected.")
                            .font(.callout).foregroundStyle(Theme.muted)
                        Link("Submit a price observation", destination: reportURL).font(.callout.weight(.bold)).tint(Theme.brand)
                    }
                    .cardStyle(tint: Theme.hueLavender)
                }
                .padding(16)
            }
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle("Transparency")
            .navigationBarTitleDisplayMode(.inline)
            .refreshable { await store.load() }
        }
    }
}

// MARK: - Health tab

private struct HealthTab: View {
    @ObservedObject var store: CaughtaKWHStationPricingStore

    var body: some View {
        let stations = store.stations
        let price = stations.filter { $0.lastScrapeHadPrice == true && $0.lastScrapeBlocked != true }.count
        let blocked = stations.filter { $0.lastScrapeBlocked == true }.count
        let availability = stations.filter { $0.lastScrapeHadAvailability == true && $0.lastScrapeHadPrice != true && $0.lastScrapeBlocked != true }.count
        let notChecked = stations.filter { $0.lastScrapedAt == nil && $0.lastScrapeBlocked != true }.count
        let checkedNoPrice = max(0, stations.count - price - blocked - availability - notChecked)
        let current = Set(store.predictions.filter(\.isCurrent).map(\.stationId)).count
        let outcomes: [(String, Int, Color)] = [
            ("Price found", price, Theme.hueSage), ("Availability only", availability, Theme.hueSlate),
            ("Blocked", blocked, Theme.hueRose), ("No price shown", checkedNoPrice, Theme.hueOchre), ("Not checked yet", notChecked, Theme.hueLavender)
        ]
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    HStack(spacing: 12) {
                        Mascot(mood: current > 0 ? .happy : .sleepy, size: 52)
                        SectionHeader(eyebrow: "System health", title: current > 0 ? "\(current) fresh price\(current == 1 ? "" : "s")" : "Historical pricing only")
                    }
                    .cardStyle(tint: current > 0 ? Theme.hueSage : Theme.hueOchre)
                    VStack(alignment: .leading, spacing: 10) {
                        SectionHeader(eyebrow: "Latest scrape outcomes", title: "\(stations.count.formatted()) stations")
                        ForEach(outcomes, id: \.0) { name, count, color in
                            HStack {
                                Circle().fill(color).frame(width: 10, height: 10)
                                Text(name).foregroundStyle(Theme.ink)
                                Spacer()
                                Text(count.formatted()).monospacedDigit().fontWeight(.bold).foregroundStyle(Theme.ink)
                            }
                            .font(.subheadline)
                        }
                    }
                    .cardStyle()
                    Text("A recent price means observed within the last 2 hours. Tesla’s anti-bot protection blocks some automated checks; blocked stations keep their saved history and are retried later.")
                        .font(.footnote).foregroundStyle(Theme.muted)
                }
                .padding(16)
            }
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle("System health")
            .navigationBarTitleDisplayMode(.inline)
            .refreshable { await store.load() }
        }
    }
}

// MARK: - Compare tab

private struct CompareTab: View {
    @ObservedObject var store: CaughtaKWHStationPricingStore
    var openStation: (String) -> Void
    @State private var energyKwh = 45.0

    private struct Row: Identifiable {
        let station: CaughtaKWHStation
        let price: Double?
        let fresh: Bool
        let miles: Double?
        var id: String { station.id }
        func cost(_ kwh: Double) -> Double? { price.map { $0 * kwh } }
    }

    private var rows: [Row] {
        store.comparison.compactMap { id in
            guard let station = store.station(id) else { return nil }
            let member = store.prediction(for: id, type: .member)
            let fresh = member?.isCurrent == true
            let price = fresh ? (member?.latestObservedPrice ?? member?.expectedPrice) : (member?.expectedPrice ?? member?.averageObservedPrice ?? member?.latestObservedPrice)
            return Row(station: station, price: price, fresh: fresh, miles: store.distanceMiles(to: station))
        }
    }

    var body: some View {
        let rows = self.rows
        let cheapest = rows.filter { $0.price != nil }.min { ($0.price ?? 0) < ($1.price ?? 0) }?.id
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if rows.isEmpty {
                        HStack(spacing: 12) {
                            Mascot(mood: .searching, size: 52)
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Nothing to compare yet").font(.headline).foregroundStyle(Theme.ink)
                                Text("Open a charger and tap Compare to add up to four stations side by side.").font(.callout).foregroundStyle(Theme.muted)
                            }
                        }
                        .cardStyle()
                    } else {
                        VStack(alignment: .leading) {
                            Text("Session size: \(Int(energyKwh)) kWh").font(.caption.weight(.heavy)).foregroundStyle(Theme.muted)
                            Slider(value: $energyKwh, in: 10...100, step: 5).tint(Theme.brand)
                        }
                        .cardStyle()
                        ForEach(rows) { row in
                            VStack(alignment: .leading, spacing: 8) {
                                HStack {
                                    Text(row.station.name).font(.headline).foregroundStyle(Theme.ink).lineLimit(2)
                                    Spacer()
                                    if row.id == cheapest && rows.count > 1 {
                                        Text("Cheapest").font(.caption.weight(.heavy)).padding(.horizontal, 8).padding(.vertical, 3)
                                            .background(Theme.hueSage.opacity(0.3), in: Capsule()).foregroundStyle(Theme.sage)
                                    }
                                }
                                HStack {
                                    DetailColumn(row.fresh ? "Recent rate" : "Modeled / historical", currency(row.price) + "/kWh")
                                    DetailColumn("\(Int(energyKwh)) kWh session", currency(row.cost(energyKwh)))
                                }
                                HStack {
                                    DetailColumn("Distance", row.miles.map { String(format: "%.1f mi", $0) } ?? "—")
                                    DetailColumn("Power", row.station.maxKw.map { "\($0) kW" } ?? "—")
                                }
                                HStack {
                                    Button("Open") { openStation(row.id) }.font(.callout.weight(.bold)).tint(Theme.brand)
                                    Spacer()
                                    Button("Remove", role: .destructive) { store.toggleComparison(row.id) }.font(.callout)
                                }
                            }
                            .cardStyle(tint: row.id == cheapest ? Theme.hueSage : nil)
                        }
                    }
                }
                .padding(16)
            }
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle("Compare")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

// MARK: - Support

private struct SupportCard: View {
    private let supportURL = URL(string: "https://linktr.ee/teslafi")!
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Support development", systemImage: "heart.fill").font(.headline).foregroundStyle(Theme.brand)
            Text("If this CaughtaKWH view helps inside MY EV Companion, you can support continued development here.")
                .font(.callout).foregroundStyle(Theme.muted)
            Link("Open support page", destination: supportURL).font(.callout.weight(.semibold)).tint(Theme.brand)
        }
        .cardStyle(tint: Theme.hueRose)
    }
}

#Preview {
    CaughtaKWHSuperchargerPricingView()
}
