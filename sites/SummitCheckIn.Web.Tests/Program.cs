using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using SummitCheckIn.Web;

static DefaultHttpContext RequestWith(string? password)
{
    var context = new DefaultHttpContext();
    if (password is not null) context.Request.Headers["X-Summit-Password"] = password;
    return context;
}

static void Equal<T>(T expected, T actual, string scenario)
{
    if (!EqualityComparer<T>.Default.Equals(expected, actual))
    {
        throw new InvalidOperationException($"{scenario}: expected {expected}, got {actual}");
    }
}

static ApiFailureException Failure(Action action, string scenario)
{
    try
    {
        action();
    }
    catch (ApiFailureException error)
    {
        return error;
    }

    throw new InvalidOperationException($"{scenario}: expected an API failure");
}

var configured = new ConfigurationBuilder()
    .AddInMemoryCollection(new Dictionary<string, string?>
    {
        ["Summit:AccessPassword"] = "basic-test",
        ["Summit:AdminPassword"] = "admin-test"
    })
    .Build();
var access = new AccessService(configured);

Equal("basic", access.Require(RequestWith("basic-test").Request, adminOnly: false), "basic access");
Equal("admin", access.Require(RequestWith("admin-test").Request, adminOnly: false), "admin grants basic access");
Equal("admin", access.Require(RequestWith("admin-test").Request, adminOnly: true), "admin access");

var basicOnAdmin = Failure(
    () => access.Require(RequestWith("basic-test").Request, adminOnly: true),
    "basic rejected from admin");
Equal("AUTH_REQUIRED", basicOnAdmin.Code, "basic rejected from admin code");
Equal(StatusCodes.Status401Unauthorized, basicOnAdmin.StatusCode, "basic rejected from admin status");

var wrong = Failure(
    () => access.Require(RequestWith("wrong").Request, adminOnly: false),
    "wrong password");
Equal("AUTH_REQUIRED", wrong.Code, "wrong password code");

var missing = Failure(
    () => new AccessService(new ConfigurationBuilder().Build())
        .Require(RequestWith(null).Request, adminOnly: false),
    "missing configuration");
Equal("AUTH_NOT_CONFIGURED", missing.Code, "missing configuration code");
Equal(StatusCodes.Status503ServiceUnavailable, missing.StatusCode, "missing configuration status");

Console.WriteLine("Backend access tests passed.");
