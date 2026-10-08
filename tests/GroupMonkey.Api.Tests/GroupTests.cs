using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using GroupMonkey.Api.Models;
using Microsoft.AspNetCore.Mvc.Testing;

namespace GroupMonkey.Api.Tests;

/// <summary>Groups are the top level: they hold members, own projects, and decide who can see and be assigned work.</summary>
public class GroupTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private const string Ava = "admin@groupmonkey.dev";      // Admin
    private const string Marcus = "manager@groupmonkey.dev";  // Manager: owns Web Team + Mobile Team, member of Platform & Ops
    private const string Priya = "member@groupmonkey.dev";    // Member of Web Team + Mobile Team

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };

    // xUnit creates a new instance of this class per test, so each test gets its own app (fresh seed data) that all
    // of its users share.
    private readonly WebApplicationFactory<Program> _app = factory.WithWebHostBuilder(_ => { });

    private async Task<HttpClient> Isolated(string email)
    {
        var c = _app.CreateClient();
        var res = await c.PostAsJsonAsync("/api/auth/login", new LoginRequest(email, "password123"));
        res.EnsureSuccessStatusCode();
        var body = (await res.Content.ReadFromJsonAsync<LoginResponse>(Json))!;
        c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", body.Token);
        return c;
    }

    [Fact]
    public async Task You_only_see_groups_you_belong_to()
    {
        var priya = await Isolated(Priya);
        var groups = (await priya.GetFromJsonAsync<List<GroupDto>>("/api/groups", Json))!;
        Assert.Equal(["Mobile Team", "Web Team"], groups.Select(g => g.Name).Order().ToArray());

        var ava = await Isolated(Ava);
        Assert.Equal(3, (await ava.GetFromJsonAsync<List<GroupDto>>("/api/groups", Json))!.Count);
    }

    [Fact]
    public async Task Group_progress_rolls_up_its_projects()
    {
        var ava = await Isolated(Ava);
        var web = (await ava.GetFromJsonAsync<List<GroupDto>>("/api/groups", Json))!.Single(g => g.Name == "Web Team");
        Assert.Equal(1, web.ProjectCount);
        Assert.Equal(10, web.TaskCount);
        Assert.Equal(3, web.DoneCount);
        Assert.Equal(30, web.Percent);
    }

    [Fact]
    public async Task Projects_of_other_groups_are_invisible()
    {
        var priya = await Isolated(Priya);
        Assert.Equal(HttpStatusCode.NotFound, (await priya.GetAsync("/api/groups/3")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await priya.GetAsync("/api/projects/3")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await priya.GetAsync("/api/projects/3/tasks")).StatusCode);
    }

    [Fact]
    public async Task A_manager_creates_a_group_with_members_and_owns_it()
    {
        var marcus = await Isolated(Marcus);
        var res = await marcus.PostAsJsonAsync("/api/groups", new GroupInput("QA Guild", "Testing", "#FFFFFF", [3, 4]), Json);
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var g = (await res.Content.ReadFromJsonAsync<GroupDto>(Json))!;
        Assert.Equal(2, g.OwnerId);
        Assert.Equal([2, 3, 4], g.MemberIds.Order().ToArray()); // creator is added automatically
        Assert.True(g.CanManage);

        // Duplicate names are refused, and members can't create groups.
        Assert.Equal(HttpStatusCode.BadRequest, (await marcus.PostAsJsonAsync("/api/groups", new GroupInput("qa guild", null, null, null), Json)).StatusCode);
        var priya = await Isolated(Priya);
        Assert.Equal(HttpStatusCode.Forbidden, (await priya.PostAsJsonAsync("/api/groups", new GroupInput("Nope", null, null, null), Json)).StatusCode);

        // Members of the new group can see it; others can't.
        var sam = await Isolated("sam@groupmonkey.dev");
        Assert.Equal(HttpStatusCode.OK, (await sam.GetAsync($"/api/groups/{g.Id}")).StatusCode);
    }

    [Fact]
    public async Task Projects_are_created_inside_a_group_the_caller_manages()
    {
        var marcus = await Isolated(Marcus);

        // No group given.
        var none = await marcus.PostAsJsonAsync("/api/projects", new ProjectInput("Loose", null, null, null, null, null), Json);
        Assert.Equal(HttpStatusCode.BadRequest, none.StatusCode);

        // Marcus is a Manager and a member of Platform & Ops (owned by Ava), so he can manage it.
        var ok = await marcus.PostAsJsonAsync("/api/projects", new ProjectInput("Runbooks", null, null, null, null, 3), Json);
        Assert.Equal(HttpStatusCode.Created, ok.StatusCode);
        Assert.Equal(3, (await ok.Content.ReadFromJsonAsync<ProjectDto>(Json))!.GroupId);

        // A group he is not in doesn't exist as far as he is concerned.
        var ava = await Isolated(Ava);
        var secret = (await (await ava.PostAsJsonAsync("/api/groups", new GroupInput("Admin Only", null, null, null), Json)).Content.ReadFromJsonAsync<GroupDto>(Json))!;
        var hidden = await marcus.PostAsJsonAsync("/api/projects", new ProjectInput("Sneaky", null, null, null, null, secret.Id), Json);
        Assert.Equal(HttpStatusCode.BadRequest, hidden.StatusCode);
    }

    [Fact]
    public async Task Tasks_can_only_be_assigned_to_members_of_the_projects_group()
    {
        var ava = await Isolated(Ava);
        // Project 3 belongs to Platform & Ops (Ava, Marcus, Sam). Priya isn't in it.
        var outsider = await ava.PatchAsJsonAsync("/api/tasks/19/assignee", new AssigneeInput(3), Json);
        Assert.Equal(HttpStatusCode.BadRequest, outsider.StatusCode);
        var insider = await ava.PatchAsJsonAsync("/api/tasks/19/assignee", new AssigneeInput(4), Json);
        Assert.Equal(HttpStatusCode.OK, insider.StatusCode);

        // Same rule when creating a task.
        var create = await ava.PostAsJsonAsync("/api/projects/3/tasks", new TaskInput("Check", null, null, null, 3, null, null), Json);
        Assert.Equal(HttpStatusCode.BadRequest, create.StatusCode);
    }

    [Fact]
    public async Task Adding_someone_to_the_group_makes_them_assignable_and_removing_unassigns_them()
    {
        var marcus = await Isolated(Marcus);

        // Priya joins Platform & Ops...
        (await marcus.PostAsync("/api/groups/3/members/3", null)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.OK, (await marcus.PatchAsJsonAsync("/api/tasks/19/assignee", new AssigneeInput(3), Json)).StatusCode);

        // ...and leaving takes her tasks back.
        (await marcus.DeleteAsync("/api/groups/3/members/3")).EnsureSuccessStatusCode();
        var tasks = (await marcus.GetFromJsonAsync<List<TaskItem>>("/api/projects/3/tasks", Json))!;
        Assert.Null(tasks.Single(t => t.Id == 19).AssigneeId);
    }

    [Fact]
    public async Task Removing_a_member_unassigns_their_tasks_and_hides_the_group_from_them()
    {
        var marcus = await Isolated(Marcus);
        var sam = await Isolated("sam@groupmonkey.dev");
        Assert.Equal(HttpStatusCode.OK, (await sam.GetAsync("/api/projects/1")).StatusCode);

        var removed = await marcus.DeleteAsync("/api/groups/1/members/4");
        removed.EnsureSuccessStatusCode();

        var tasks = (await marcus.GetFromJsonAsync<List<TaskItem>>("/api/projects/1/tasks", Json))!;
        Assert.DoesNotContain(tasks, t => t.AssigneeId == 4);
        Assert.Equal(WorkStatus.Todo, tasks.Single(t => t.Id == 8).Status); // work is untouched, just unassigned
        Assert.Equal(HttpStatusCode.NotFound, (await sam.GetAsync("/api/projects/1")).StatusCode);
    }

    [Fact]
    public async Task The_owner_cannot_be_removed_from_their_group()
    {
        var marcus = await Isolated(Marcus);
        var res = await marcus.DeleteAsync("/api/groups/1/members/2");
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Updating_a_group_can_replace_its_members()
    {
        var marcus = await Isolated(Marcus);
        var res = await marcus.PutAsJsonAsync("/api/groups/1", new GroupInput("Web Team", "Websites", null, [3]), Json);
        res.EnsureSuccessStatusCode();
        var g = (await res.Content.ReadFromJsonAsync<GroupDto>(Json))!;
        Assert.Equal([2, 3], g.MemberIds.Order().ToArray()); // owner always stays
        var tasks = (await marcus.GetFromJsonAsync<List<TaskItem>>("/api/projects/1/tasks", Json))!;
        Assert.DoesNotContain(tasks, t => t.AssigneeId is 1 or 4);
    }

    [Fact]
    public async Task Only_the_owner_or_an_admin_can_delete_a_group_and_it_takes_its_projects_with_it()
    {
        var marcus = await Isolated(Marcus);
        // Marcus manages Platform & Ops but Ava owns it.
        Assert.Equal(HttpStatusCode.Forbidden, (await marcus.DeleteAsync("/api/groups/3")).StatusCode);

        var ava = await Isolated(Ava);
        Assert.Equal(HttpStatusCode.NoContent, (await ava.DeleteAsync("/api/groups/3")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await ava.GetAsync("/api/projects/3")).StatusCode);
        var projects = (await ava.GetFromJsonAsync<List<ProjectDto>>("/api/projects", Json))!;
        Assert.DoesNotContain(projects, p => p.GroupId == 3);
    }

    [Fact]
    public async Task A_project_cannot_be_moved_to_another_group()
    {
        var marcus = await Isolated(Marcus);
        var res = await marcus.PutAsJsonAsync("/api/projects/1", new ProjectInput("Website Relaunch 2", null, null, null, null, 2), Json);
        res.EnsureSuccessStatusCode();
        var p = (await res.Content.ReadFromJsonAsync<ProjectDto>(Json))!;
        Assert.Equal("Website Relaunch 2", p.Name);
        Assert.Equal(1, p.GroupId); // unchanged
    }

    [Fact]
    public async Task Members_can_work_tasks_but_cannot_manage_the_group_or_its_projects()
    {
        var priya = await Isolated(Priya);
        Assert.Equal(HttpStatusCode.Forbidden, (await priya.PostAsync("/api/groups/1/members/1", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await priya.PutAsJsonAsync("/api/projects/1", new ProjectInput("x", null, null, null, null, null), Json)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await priya.DeleteAsync("/api/projects/1")).StatusCode);
        var group = (await priya.GetFromJsonAsync<GroupDto>("/api/groups/1", Json))!;
        Assert.False(group.CanManage);
        Assert.Equal(HttpStatusCode.OK, (await priya.PatchAsJsonAsync("/api/tasks/8/status", new StatusInput(WorkStatus.InProgress), Json)).StatusCode);
    }
}
