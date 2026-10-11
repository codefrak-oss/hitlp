import SwiftUI
import HITLPSurfaceKit

/// Who asked, as the server verified it (spec 5.1 `attested`). Green, with a seal.
struct AttestedSection: View {
    let attested: Attested?

    var body: some View {
        Section {
            if let a = attested {
                LabeledContent("Requester", value: a.requester)
                if let obo = a.onBehalfOf { LabeledContent("On behalf of", value: describe(obo)) }
                LabeledContent("Verified by", value: a.by)
            } else {
                Text("The server attested nothing for this task.").foregroundStyle(.secondary)
            }
        } header: {
            Label("Verified by the server", systemImage: "checkmark.seal.fill").foregroundStyle(.green)
        }
        .listRowBackground(Color.green.opacity(0.12))
    }
}

/// What the requester claims (spec 5.1 `asserted`): never shown as verified.
/// Amber, with a speech bubble; the recommendation lives here only.
struct AssertedSection: View {
    let asserted: Asserted?
    @State private var lineageOpen = false

    var body: some View {
        Section {
            if let a = asserted {
                if let why = a.why { LabeledContent("Why (claimed)") { Text(why) } }
                if let obo = a.onBehalfOf { LabeledContent("On behalf of (claimed)", value: describe(obo)) }
                if let lineage = a.lineage, !lineage.isEmpty {
                    // Collapsed by default; shown in the order received (newest first).
                    DisclosureGroup("Lineage (\(lineage.count))", isExpanded: $lineageOpen) {
                        ForEach(Array(lineage.enumerated()), id: \.offset) { _, link in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(link.kind.uppercased()).font(.caption2.bold()).foregroundStyle(.orange)
                                Text(link.claim)
                                if let by = link.by { Text("by \(by)").font(.caption).foregroundStyle(.secondary) }
                            }
                        }
                    }
                }
                if let asOf = a.asOf { LabeledContent("As of", value: asOf) }
            } else {
                Text("The requester claimed nothing more.").foregroundStyle(.secondary)
            }
        } header: {
            Label("Claimed by the requester, not verified", systemImage: "text.bubble").foregroundStyle(.orange)
        }
        .listRowBackground(Color.orange.opacity(0.10))
    }
}

/// The requester's recommendation, at the top of the card but inside the
/// asserted styling and heading: it is a claim, not a verdict of the server.
struct RecommendationSection: View {
    let recommendation: Recommendation

    var body: some View {
        Section {
            HStack {
                Text(recommendation.verdict.rawValue.uppercased()).font(.headline).foregroundStyle(color)
                Spacer()
                if let c = recommendation.confidence { Text("confidence \(Int((c * 100).rounded()))%").foregroundStyle(.secondary) }
            }
            if let by = recommendation.by, !by.label.isEmpty { LabeledContent("Judged by", value: by.label) }
            ForEach(recommendation.reasons ?? [], id: \.self) { Text("• \($0)") }
        } header: {
            Label("Recommendation, claimed by the requester", systemImage: "text.bubble").foregroundStyle(.orange)
        }
        .listRowBackground(Color.orange.opacity(0.10))
    }

    private var color: Color {
        switch recommendation.verdict {
        case .allow: return .green
        case .deny: return .red
        case .escalate: return .yellow
        case .none: return .secondary
        }
    }
}

func describe(_ value: JSONValue) -> String {
    if case .object(let o) = value, let kind = o["kind"]?.stringValue, let id = o["id"]?.stringValue {
        return "\(kind) \(id)"
    }
    return value.jsonText
}
