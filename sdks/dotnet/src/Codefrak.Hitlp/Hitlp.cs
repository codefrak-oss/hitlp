using System.Globalization;

namespace Codefrak.Hitlp;

/// <summary>Constants of HITLP v1.0 (draft): spec/hitlp.md sections 4-7.</summary>
public static class Hitlp
{
    /// <summary>The spec version this SDK implements.</summary>
    public const string SpecVersion = "1.0-draft";

    /// <summary>An RFC 3339 date-time in UTC, e.g. <c>2026-10-09T09:00:00Z</c>, for deadlines and timestamps.</summary>
    public static string FormatDateTime(DateTimeOffset value) =>
        value.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.FFFFFFF'Z'", CultureInfo.InvariantCulture);
}
