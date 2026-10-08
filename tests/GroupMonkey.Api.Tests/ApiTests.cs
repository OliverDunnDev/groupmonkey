using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using GroupMonkey.Api.Models;
using Microsoft.AspNetCore.Mvc.Testing;

namespace GroupMonkey.Api.Tests;

public class ApiTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };

    // Each test gets its own factory so seeded data is fresh.
    private HttpClient NewClient() => factory.WithWebHostBuilder(_ => { }).CreateClient();

    private static async Task<HttpClient> LoginAs(HttpClient c, string email)
    {
        var res = await c.PostAsJsonAsync("/api/auth/login", new LoginRequest(email, "password123"));
        res.EnsureSuccessStatusCode();
        var body = (await res.Content.ReadFromJsonAsync<LoginResponse>(Json))!;
        c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", body.Token);
        return c;
    }

    [Fact]
    public async Task Login_with_bad_password_is_401()
    {
        var res = await NewClient().PostAsJsonAsync("/api/auth/login", new LoginRequest("admin@groupmonkey.dev", "nope"));
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task Protected_routes_require_token()
    {
        var res = await NewClient().GetAsync("/api/projects");
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task Admin_sees_all_projects_member_sees_only_theirs()
    {
        var admin = await LoginAs(NewClient(), "admin@groupmonkey.dev");
        var all = await admin.GetFromJsonAsync<List<ProjectDto>>("/api/projects", Json);
        Assert.Equal(3, all!.Count);

        var member = await LoginAs(NewClient(), "member@groupmonkey.dev");
        var mine = await member.GetFromJsonAsync<List<ProjectDto>>("/api/projects", Json);
        Assert.Equal(2, mine!.Count);
        Assert.DoesNotContain(mine, p => p.Name == "Internal Tooling");
    }

    [Fact]
    public async Task Non_member_cannot_see_project()
    {
        var member = await LoginAs(NewClient(), "member@groupmonkey.dev");
        var res = await member.GetAsync("/api/projects/3");
        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
    }

    [Fact]
    public async Task Summary_progress_matches_seed()
    {
        var admin = await LoginAs(NewClient(), "admin@groupmonkey.dev");
        var s = (await admin.GetFromJsonAsync<ProjectSummary>("/api/projects/1/summary", Json))!;
        Assert.Equal(10, s.Total);
        Assert.Equal(3, s.Done);
        Assert.Equal(30, s.Percent);
        Assert.Equal(1, s.Overdue);
    }

    [Fact]
    public async Task Changing_task_status_updates_progress_and_goal()
    {
        var c = await LoginAs(NewClient(), "member@groupmonkey.dev");
        var goalsBefore = (await c.GetFromJsonAsync<List<GoalDto>>("/api/projects/1/goals", Json))!;
        var homepage = goalsBefore.Single(g => g.Title == "Launch new homepage");

        // Task 3 (Hero section build) belongs to the homepage goal.
        var res = await c.PatchAsJsonAsync("/api/tasks/3/status", new StatusInput(WorkStatus.Done), Json);
        res.EnsureSuccessStatusCode();

        var goalsAfter = (await c.GetFromJsonAsync<List<GoalDto>>("/api/projects/1/goals", Json))!;
        Assert.Equal(homepage.DoneCount + 1, goalsAfter.Single(g => g.Id == homepage.Id).DoneCount);
        var summary = (await c.GetFromJsonAsync<ProjectSummary>("/api/projects/1/summary", Json))!;
        Assert.Equal(4, summary.Done);
    }

    [Fact]
    public async Task Assignee_must_be_project_member()
    {
        var admin = await LoginAs(NewClient(), "admin@groupmonkey.dev");
        // Project 2 does not include user 1.
        var res = await admin.PatchAsJsonAsync("/api/tasks/11/assignee", new AssigneeInput(1), Json);
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Group_membership_add_and_remove()
    {
        var mgr = await LoginAs(NewClient(), "manager@groupmonkey.dev");
        var added = await mgr.PostAsync("/api/groups/1/members/4", null);
        added.EnsureSuccessStatusCode();
        var g = (await added.Content.ReadFromJsonAsync<GroupDto>(Json))!;
        Assert.Contains(4, g.MemberIds);

        var removed = await mgr.DeleteAsync("/api/groups/1/members/4");
        var g2 = (await removed.Content.ReadFromJsonAsync<GroupDto>(Json))!;
        Assert.DoesNotContain(4, g2.MemberIds);
    }

    [Fact]
    public async Task Member_cannot_create_group_or_project()
    {
        var member = await LoginAs(NewClient(), "member@groupmonkey.dev");
        var g = await member.PostAsJsonAsync("/api/projects/1/groups", new GroupInput("Nope", null), Json);
        Assert.Equal(HttpStatusCode.Forbidden, g.StatusCode);
        var p = await member.PostAsJsonAsync("/api/projects", new ProjectInput("Nope", null, null, null, null, null), Json);
        Assert.Equal(HttpStatusCode.Forbidden, p.StatusCode);
    }

    [Fact]
    public async Task Manager_can_create_project_and_task()
    {
        var mgr = await LoginAs(NewClient(), "manager@groupmonkey.dev");
        var pr = await mgr.PostAsJsonAsync("/api/projects", new ProjectInput("Fresh", "desc", null, null, null, [3]), Json);
        Assert.Equal(HttpStatusCode.Created, pr.StatusCode);
        var proj = (await pr.Content.ReadFromJsonAsync<ProjectDto>(Json))!;
        Assert.Contains(2, proj.MemberIds);

        var t = await mgr.PostAsJsonAsync($"/api/projects/{proj.Id}/tasks",
            new TaskInput("First task", null, null, Priority.High, 3, null, null, null), Json);
        Assert.Equal(HttpStatusCode.Created, t.StatusCode);
    }

    [Fact]
    public async Task Deleting_goal_unlinks_tasks()
    {
        var mgr = await LoginAs(NewClient(), "manager@groupmonkey.dev");
        var del = await mgr.DeleteAsync("/api/goals/1");
        Assert.Equal(HttpStatusCode.NoContent, del.StatusCode);
        var tasks = (await mgr.GetFromJsonAsync<List<TaskItem>>("/api/projects/1/tasks", Json))!;
        Assert.DoesNotContain(tasks, t => t.GoalId == 1);
        Assert.Equal(10, tasks.Count);
    }
}
