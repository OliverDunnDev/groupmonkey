using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using GroupMonkey.Api.Data;
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

    // ---- groups: the unit of access. Everything else inherits from the group a project lives in. ----

    public static bool CanViewGroup(User u, Group g) =>
        u.Role == Role.Admin || g.OwnerId == u.Id || g.MemberIds.Contains(u.Id);

    /// <summary>Admins and the manager who created the group. Can delete the group.</summary>
    public static bool CanEditGroup(User u, Group g) => u.Role == Role.Admin || g.OwnerId == u.Id;

    /// <summary>Also any Manager who is in the group. Can change members and create/edit projects and goals in it.</summary>
    public static bool CanManageGroup(User u, Group g) =>
        CanEditGroup(u, g) || (u.Role == Role.Manager && g.MemberIds.Contains(u.Id));

    // ---- projects: same rules as their group ----

    public static bool CanView(DataStore s, User u, Project p) => s.GroupOf(p) is { } g && CanViewGroup(u, g);

    public static bool CanManage(DataStore s, User u, Project p) => s.GroupOf(p) is { } g && CanManageGroup(u, g);

    // Editing or deleting a project takes the same permission as managing it.
    public static bool CanEdit(DataStore s, User u, Project p) => CanManage(s, u, p);

    public static UserDto ToDto(this User u) => new(u.Id, u.Name, u.Email, u.Role, u.Color, u.Kind);
}
