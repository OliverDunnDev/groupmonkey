using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using GroupMonkey.Api.Models;
using Microsoft.IdentityModel.Tokens;

namespace GroupMonkey.Api.Services;

public class JwtOptions
{
    // Development-only signing key for the mock app. Override via configuration for anything real.
    public string Key { get; set; } = "groupmonkey-dev-only-signing-key-change-me-0123456789";
    public string Issuer { get; set; } = "groupmonkey";
    public int Hours { get; set; } = 12;
}

public class TokenService(JwtOptions opts)
{
    public string Create(User u)
    {
        var creds = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(opts.Key)), SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(
            opts.Issuer, opts.Issuer,
            [new Claim("sub", u.Id.ToString()), new Claim("role", u.Role.ToString()), new Claim("name", u.Name)],
            expires: DateTime.UtcNow.AddHours(opts.Hours), signingCredentials: creds);
        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}

public static class Access
{
    public static int UserId(this ClaimsPrincipal p) =>
        int.TryParse(p.FindFirst("sub")?.Value, out var id) ? id : 0;

    public static bool CanView(User u, Project p) =>
        u.Role == Role.Admin || p.OwnerId == u.Id || p.MemberIds.Contains(u.Id);

    // Owners and admins can edit the project itself.
    public static bool CanEdit(User u, Project p) => u.Role == Role.Admin || p.OwnerId == u.Id;

    // Managers on the project can also organise groups and goals.
    public static bool CanManage(User u, Project p) =>
        CanEdit(u, p) || (u.Role == Role.Manager && p.MemberIds.Contains(u.Id));

    public static UserDto ToDto(this User u) => new(u.Id, u.Name, u.Email, u.Role, u.Color, u.Kind);
}
