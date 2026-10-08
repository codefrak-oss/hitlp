namespace Codefrak.Hitlp;

/// <summary>Idempotency keys (rule R4).</summary>
public static class Idempotency
{
    /// <summary>
    /// A fresh idempotency key for a new logical request (rule R4). Reuse the key
    /// you got here on every retry of that request; never mint a new one to retry.
    /// </summary>
    public static string NewIdempotencyKey(string? prefix = null)
    {
        var id = Guid.NewGuid().ToString();
        return string.IsNullOrEmpty(prefix) ? id : prefix + "-" + id;
    }
}
