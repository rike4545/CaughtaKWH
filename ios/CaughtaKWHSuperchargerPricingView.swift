//
//  CaughtaKWHSuperchargerPricingView.swift
//  CaughtaKWH
//
//  Created by Bryan on 2026-05-27.
//

import SwiftUI
import Foundation

// MARK: - Models

struct CaughtaKWHStation: Identifiable, Codable, Hashable {
    let id: String
    let name: String
    let city: String?
    let state: String?
    let address: String?
    let url: String?
    let stalls: Int?
    let maxKw: Int?
    let estimatedSiteKw: Int?
    let capacitySource: String?
    let capacityConfidence: String?
    let lastScrapedAt: Date?
    let lastScrapeHadPrice: Bool?
    let lastScrapeHadAvailability: Bool?
}

struct CaughtaKWHPrediction: Identifiable, Codable, Hashable {
    var id: String { "\(stationId)-\(membershipType)" }
    let stationId: String
    let membershipType: String
    let latestObservedAt: Date?
    let latestObservedPrice: Double?
    let latestObservationAgeHours: Double?
    let freshnessLabel: String?
    let confidenceLabel: String?
    let confidenceScore: Int?
    let confidenceSummary: String?
    let sampleCount: Int?
    let volatility: Double?
}

struct CaughtaKWHHistoryObservation: Identifiable, Codable, Hashable {
    var id: String { "\(stationId)-\(capturedAt?.timeIntervalSince1970 ?? 0)" }
    let stationId: String
    let capturedAt: Date?
    let memberPricePerKwh: Double?
    let nonMemberPricePerKwh: Double?
    let availableStalls: Int?
    let totalStalls: Int?
    let utilizationPct: Double?
}

// MARK: - Data Service

@MainActor
final class CaughtaKWHStationPricingStore: ObservableObject {
    @Published var stations: [CaughtaKWHStation] = []
    @Published var predictions: [CaughtaKWHPrediction] = []
    @Published var history: [CaughtaKWHHistoryObservation] = []
    @Published var selectedStationID: String = "LakeGroveNYsupercharger"
    @Published var isLoading = false
    @Published var errorMessage: String?

    private let baseURL = URL(string: "https://rike4545.github.io/CaughtaKWH/data")!
    private let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()

    var selectedStation: CaughtaKWHStation? {
        stations.first(where: { $0.id == selectedStationID }) ?? stations.first
    }

    var selectedPrediction: CaughtaKWHPrediction? {
        guard let stationID = selectedStation?.id else { return nil }
        return predictions.first(where: { $0.stationId == stationID && $0.membershipType == "member" })
            ?? predictions.first(where: { $0.stationId == stationID })
    }

    var latestHistory: CaughtaKWHHistoryObservation? {
        history.sorted { ($0.capturedAt ?? .distantPast) < ($1.capturedAt ?? .distantPast) }.last
    }

    func load() async {
        isLoading = true
        errorMessage = nil
        do {
            async let stationRows: [CaughtaKWHStation] = fetch("stations.json")
            async let predictionRows: [CaughtaKWHPrediction] = fetch("predictions.json")
            stations = try await stationRows
            predictions = try await predictionRows
            if selectedStation == nil, let first = stations.first { selectedStationID = first.id }
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

// MARK: - View

struct CaughtaKWHSuperchargerPricingView: View {
    @StateObject private var store = CaughtaKWHStationPricingStore()
    @State private var searchText = ""

    private var filteredStations: [CaughtaKWHStation] {
        guard !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return store.stations }
        let query = searchText.lowercased()
        return store.stations.filter { station in
            [station.name, station.city, station.state, station.address, station.id]
                .compactMap { $0 }
                .joined(separator: " ")
                .lowercased()
                .contains(query)
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    header

                    if let errorMessage = store.errorMessage {
                        warningCard(title: "Could not load data", message: errorMessage)
                    }

                    if let station = store.selectedStation {
                        stationPicker
                        truthCard(station: station, prediction: store.selectedPrediction)
                        priceAndCapacityGrid(station: station, prediction: store.selectedPrediction)
                        capacityDetailCard(station: station)
                        staleDataCard(prediction: store.selectedPrediction)
                    } else if store.isLoading {
                        ProgressView("Loading CaughtaKWH data…")
                            .frame(maxWidth: .infinity, alignment: .center)
                            .padding(.vertical, 40)
                    } else {
                        warningCard(title: "No station selected", message: "No station data is available yet.")
                    }
                }
                .padding()
            }
            .navigationTitle("CaughtaKWH")
            .searchable(text: $searchText, prompt: "Search Superchargers")
            .task { await store.load() }
            .refreshable { await store.load() }
            .background(Color(.systemGroupedBackground))
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Supercharger pricing intelligence", systemImage: "bolt.car")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.green)
                .textCase(.uppercase)
            Text("Separate current Tesla visibility from stale historical observations.")
                .font(.largeTitle.bold())
                .minimumScaleFactor(0.75)
            Text("Tesla app and vehicle pricing remains the source of truth. CaughtaKWH shows public-page observations, confidence, freshness, and station capacity context.")
                .font(.callout)
                .foregroundStyle(.secondary)
        }
    }

    private var stationPicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Station")
                .font(.headline)
            Picker("Station", selection: $store.selectedStationID) {
                ForEach(filteredStations.prefix(250)) { station in
                    Text(station.name).tag(station.id)
                }
            }
            .pickerStyle(.navigationLink)
            .onChange(of: store.selectedStationID) { _, _ in
                Task { await store.loadHistoryForSelectedStation() }
            }
        }
        .cardStyle()
    }

    private func truthCard(station: CaughtaKWHStation, prediction: CaughtaKWHPrediction?) -> some View {
        let state = pricingState(station: station, prediction: prediction)
        return VStack(alignment: .leading, spacing: 8) {
            Label(state.title, systemImage: state.symbol)
                .font(.headline)
                .foregroundStyle(state.tint)
            Text(state.message)
                .font(.callout)
                .foregroundStyle(.secondary)
        }
        .cardStyle(border: state.tint.opacity(0.35))
    }

    private func priceAndCapacityGrid(station: CaughtaKWHStation, prediction: CaughtaKWHPrediction?) -> some View {
        let capacity = capacityModel(station: station)
        let publicPriceText = station.lastScrapeHadPrice == true && !isStale(prediction)
            ? currency(prediction?.latestObservedPrice)
            : station.lastScrapeHadPrice == true ? "Stale" : "Not visible"

        return LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
            metricCard(title: "Tesla public price", value: publicPriceText, note: observationNote(prediction))
            metricCard(title: "Historical price", value: currency(prediction?.latestObservedPrice), note: prediction?.freshnessLabel ?? "No public price observation")
            metricCard(title: "Confidence", value: isStale(prediction) ? "Low" : (prediction?.confidenceLabel?.capitalized ?? "Low"), note: confidenceNote(prediction))
            metricCard(title: "Station capacity", value: capacity.total.map { "\($0) stalls" } ?? "Unknown", note: capacity.maxKw.map { "\($0) kW max · \(capacity.grade)" } ?? capacity.grade)
        }
    }

    private func capacityDetailCard(station: CaughtaKWHStation) -> some View {
        let capacity = capacityModel(station: station)
        return VStack(alignment: .leading, spacing: 12) {
            Label("Capacity detail", systemImage: "ev.charger")
                .font(.headline)
            HStack {
                detailColumn("Available now", capacity.available.map { "\($0) of \(capacity.total ?? $0)" } ?? "Not visible")
                detailColumn("Utilization", capacity.utilization.map { "\(Int(($0 * 100).rounded()))%" } ?? "Not visible")
            }
            HStack {
                detailColumn("Theoretical output", capacity.theoreticalKw.map { "\($0.formatted()) kW" } ?? "Unknown")
                detailColumn("Source", capacity.source)
            }
        }
        .cardStyle()
    }

    private func staleDataCard(prediction: CaughtaKWHPrediction?) -> some View {
        guard isStale(prediction), let prediction else { return AnyView(EmptyView()) }
        return AnyView(
            warningCard(
                title: isVeryStale(prediction) ? "Very stale pricing" : "Stale pricing",
                message: "The last historical price was observed \(ageText(prediction.latestObservationAgeHours)). Keep it for trend context, but do not treat it as current Tesla pricing."
            )
        )
    }

    private func metricCard(title: String, value: String, note: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.title3.bold())
                .lineLimit(2)
                .minimumScaleFactor(0.75)
            Text(note)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardStyle()
    }

    private func detailColumn(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.subheadline.weight(.semibold))
                .lineLimit(2)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func warningCard(title: String, message: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: "exclamationmark.triangle.fill")
                .font(.headline)
                .foregroundStyle(.orange)
            Text(message)
                .font(.callout)
                .foregroundStyle(.secondary)
        }
        .cardStyle(border: Color.orange.opacity(0.35))
    }

    private func pricingState(station: CaughtaKWHStation, prediction: CaughtaKWHPrediction?) -> (title: String, message: String, symbol: String, tint: Color) {
        if isVeryStale(prediction) {
            return ("Very stale price observation", "The last public price is more than 48 hours old. The iOS view keeps it as history only, not as a current Tesla price.", "clock.badge.exclamationmark", .orange)
        }
        if isStale(prediction) {
            return ("Stale price observation", "Tesla may have changed this price. Use the Tesla app or vehicle before relying on it.", "clock", .orange)
        }
        if let prediction, prediction.latestObservedAt != nil {
            return ("Recent Tesla public price observed", "\(currency(prediction.latestObservedPrice)) observed from Tesla public data. \(prediction.confidenceSummary ?? "")", "checkmark.seal.fill", .green)
        }
        if station.lastScrapeHadAvailability == true {
            return ("Tesla public price not visible", "Tesla exposed availability information, but not a public $/kWh price for this check.", "eye.slash", .orange)
        }
        if station.lastScrapedAt != nil {
            return ("No public Tesla price found", "The public station page was checked, but no parseable public price was found.", "magnifyingglass", .orange)
        }
        return ("Tesla price check pending", "This station has not been checked yet in the current dataset.", "hourglass", .orange)
    }

    private func capacityModel(station: CaughtaKWHStation) -> (total: Int?, available: Int?, utilization: Double?, maxKw: Int?, theoreticalKw: Int?, grade: String, source: String) {
        let latest = store.latestHistory
        let observedTotal = latest?.totalStalls
        let directoryTotal = station.stalls
        let total = observedTotal ?? directoryTotal
        let available = latest?.availableStalls
        let utilization = latest?.utilizationPct
        let maxKw = station.maxKw
        let theoretical = station.estimatedSiteKw ?? (total != nil && maxKw != nil ? total! * maxKw! : nil)
        let grade: String
        if let total {
            if total >= 20 || (total >= 12 && (maxKw ?? 0) >= 250) { grade = "High capacity" }
            else if total >= 8 { grade = "Medium capacity" }
            else { grade = "Limited capacity" }
        } else {
            grade = "Unknown capacity"
        }
        let source = observedTotal != nil ? "Latest Tesla availability observation" : station.capacitySource?.replacingOccurrences(of: "_", with: " ") ?? "Directory metadata"
        return (total, available, utilization, maxKw, theoretical, grade, source)
    }

    private func currency(_ value: Double?) -> String {
        guard let value else { return "—" }
        return value.formatted(.currency(code: "USD"))
    }

    private func ageText(_ hours: Double?) -> String {
        guard let hours else { return "No public price yet" }
        if hours < 1 { return "\(Int((hours * 60).rounded())) min old" }
        return "\(hours.formatted(.number.precision(.fractionLength(hours < 10 ? 1 : 0)))) hr old"
    }

    private func isStale(_ prediction: CaughtaKWHPrediction?) -> Bool {
        guard let hours = prediction?.latestObservationAgeHours else { return false }
        return hours > 12
    }

    private func isVeryStale(_ prediction: CaughtaKWHPrediction?) -> Bool {
        guard let hours = prediction?.latestObservationAgeHours else { return false }
        return hours > 48
    }

    private func observationNote(_ prediction: CaughtaKWHPrediction?) -> String {
        guard let prediction, prediction.latestObservedAt != nil else { return "No fresh public price" }
        return "\(shortDate(prediction.latestObservedAt)) · \(ageText(prediction.latestObservationAgeHours))"
    }

    private func confidenceNote(_ prediction: CaughtaKWHPrediction?) -> String {
        guard let prediction else { return "Needs observations" }
        let score = prediction.confidenceScore.map { "\($0)/100" } ?? "no score"
        let samples = prediction.sampleCount.map { "\($0) samples" } ?? "no samples"
        return "\(score) · \(samples)"
    }

    private func shortDate(_ date: Date?) -> String {
        guard let date else { return "—" }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
}

private extension View {
    func cardStyle(border: Color = Color.clear) -> some View {
        self
            .padding(16)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .stroke(border, lineWidth: 1)
            )
    }
}

#Preview {
    CaughtaKWHSuperchargerPricingView()
}
