using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace SummitCheckIn.Web;

public sealed class GoogleTokenProvider(IConfiguration configuration, IHttpClientFactory clients)
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private string? _token;
    private DateTimeOffset _expiresAt;

    public async Task<string> GetAsync(CancellationToken cancellationToken)
    {
        if (_token is not null && _expiresAt > DateTimeOffset.UtcNow.AddMinutes(5)) return _token;

        await _gate.WaitAsync(cancellationToken);
        try
        {
            if (_token is not null && _expiresAt > DateTimeOffset.UtcNow.AddMinutes(5)) return _token;

            var json = configuration["Google:ServiceAccountJson"];
            if (string.IsNullOrWhiteSpace(json))
                throw ConfigurationFailure("Google service-account credentials are not configured.");

            ServiceAccount credential;
            try
            {
                credential = JsonSerializer.Deserialize<ServiceAccount>(json)
                    ?? throw new JsonException("Credential JSON was empty.");
            }
            catch (JsonException)
            {
                throw ConfigurationFailure("Google service-account credentials are invalid.");
            }

            if (string.IsNullOrWhiteSpace(credential.ClientEmail) ||
                string.IsNullOrWhiteSpace(credential.PrivateKey) ||
                string.IsNullOrWhiteSpace(credential.TokenUri))
                throw ConfigurationFailure("Google service-account credentials are incomplete.");

            var now = DateTimeOffset.UtcNow;
            var header = Base64Url(JsonSerializer.SerializeToUtf8Bytes(new { alg = "RS256", typ = "JWT" }));
            var claims = Base64Url(JsonSerializer.SerializeToUtf8Bytes(new
            {
                iss = credential.ClientEmail,
                scope = "https://www.googleapis.com/auth/spreadsheets",
                aud = credential.TokenUri,
                iat = now.ToUnixTimeSeconds(),
                exp = now.AddMinutes(55).ToUnixTimeSeconds()
            }));
            var unsigned = $"{header}.{claims}";

            using var rsa = RSA.Create();
            rsa.ImportFromPem(credential.PrivateKey);
            var signature = Base64Url(rsa.SignData(
                Encoding.ASCII.GetBytes(unsigned),
                HashAlgorithmName.SHA256,
                RSASignaturePadding.Pkcs1));

            using var response = await clients.CreateClient().PostAsync(
                credential.TokenUri,
                new FormUrlEncodedContent(new Dictionary<string, string>
                {
                    ["grant_type"] = "urn:ietf:params:oauth:grant-type:jwt-bearer",
                    ["assertion"] = $"{unsigned}.{signature}"
                }),
                cancellationToken);

            if (!response.IsSuccessStatusCode)
                throw ConfigurationFailure("Google rejected the configured service-account credentials.");

            var token = await response.Content.ReadFromJsonAsync<TokenResponse>(cancellationToken: cancellationToken);
            if (string.IsNullOrWhiteSpace(token?.AccessToken))
                throw ConfigurationFailure("Google did not return an access token.");

            _token = token.AccessToken;
            _expiresAt = now.AddSeconds(token.ExpiresIn > 0 ? token.ExpiresIn : 3600);
            return _token;
        }
        finally
        {
            _gate.Release();
        }
    }

    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes)
        .TrimEnd('=')
        .Replace('+', '-')
        .Replace('/', '_');

    private static ApiFailureException ConfigurationFailure(string message) =>
        new(message, "GOOGLE_NOT_CONFIGURED", StatusCodes.Status503ServiceUnavailable);

    private sealed record ServiceAccount(
        [property: System.Text.Json.Serialization.JsonPropertyName("client_email")] string? ClientEmail,
        [property: System.Text.Json.Serialization.JsonPropertyName("private_key")] string? PrivateKey,
        [property: System.Text.Json.Serialization.JsonPropertyName("token_uri")] string? TokenUri);

    private sealed record TokenResponse(
        [property: System.Text.Json.Serialization.JsonPropertyName("access_token")] string? AccessToken,
        [property: System.Text.Json.Serialization.JsonPropertyName("expires_in")] int ExpiresIn);
}
