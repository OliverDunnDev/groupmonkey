using GroupMonkey.Api.Models;
using static GroupMonkey.Api.Models.WorkStatus;
using static GroupMonkey.Api.Models.Priority;

namespace GroupMonkey.Api.Data;

public static class SeedData
{
    public const string DemoPassword = "password123";

    public static void Populate(DataStore s)
    {
        var today = DateOnly.FromDateTime(DateTime.Today);
        DateOnly D(int days) => today.AddDays(days);

        s.Users.AddRange([
            new User { Id = 1, Name = "Ava Admin", Email = "admin@groupmonkey.dev", Password = DemoPassword, Role = Role.Admin, Color = "#FFD400" },
            new User { Id = 2, Name = "Marcus Manager", Email = "manager@groupmonkey.dev", Password = DemoPassword, Role = Role.Manager, Color = "#FFFFFF" },
            new User { Id = 3, Name = "Priya Patel", Email = "member@groupmonkey.dev", Password = DemoPassword, Role = Role.Member, Color = "#FFB800" },
            new User { Id = 4, Name = "Sam Okafor", Email = "sam@groupmonkey.dev", Password = DemoPassword, Role = Role.Member, Color = "#E8E3D3" },
        ]);

        // ---- Projects ----
        Project P(string name, string desc, ProjectStatus st, int start, int due, int owner, params int[] members)
        {
            var p = new Project
            {
                Id = s.NextProjectId(), Name = name, Description = desc, Status = st,
                StartDate = D(start), DueDate = D(due), OwnerId = owner, MemberIds = [.. members],
            };
            s.Projects.Add(p);
            return p;
        }
        Group G(Project p, string name, string color, params int[] members)
        {
            var g = new Group { Id = s.NextGroupId(), ProjectId = p.Id, Name = name, Color = color, MemberIds = [.. members] };
            s.Groups.Add(g);
            return g;
        }
        Goal Go(Project p, string title, string desc, int target)
        {
            var g = new Goal { Id = s.NextGoalId(), ProjectId = p.Id, Title = title, Description = desc, TargetDate = D(target) };
            s.Goals.Add(g);
            return g;
        }
        void T(Project p, string title, WorkStatus st, Priority pr, int? assignee, Group? grp, Goal? goal, int? due, string desc = "")
            => s.Tasks.Add(new TaskItem
            {
                Id = s.NextTaskId(), ProjectId = p.Id, Title = title, Description = desc, Status = st, Priority = pr,
                AssigneeId = assignee, GroupId = grp?.Id, GoalId = goal?.Id, DueDate = due is null ? null : D(due.Value),
            });

        // Project 1: Website Relaunch
        var web = P("Website Relaunch", "Redesign and rebuild the public marketing site with a faster, cleaner experience.", ProjectStatus.Active, -30, 45, 2, 1, 2, 3, 4);
        var webDesign = G(web, "Design", "#FFD400", 3);
        var webEng = G(web, "Engineering", "#0A0A0A", 4, 2);
        var webContent = G(web, "Content", "#FFFFFF", 3, 1);
        var webHome = Go(web, "Launch new homepage", "Ship the redesigned homepage to production.", 21);
        var webBlog = Go(web, "Migrate blog content", "Move all existing posts to the new CMS with redirects.", 35);
        var webPerf = Go(web, "Lighthouse score 90+", "Hit 90+ on performance and accessibility.", 40);
        T(web, "Homepage wireframes", Done, Medium, 3, webDesign, webHome, -20);
        T(web, "Visual design system", Done, High, 3, webDesign, webHome, -10, "Colour, type and component library.");
        T(web, "Hero section build", InProgress, High, 4, webEng, webHome, 5);
        T(web, "Navigation component", Review, Medium, 4, webEng, webHome, 3);
        T(web, "Set up CMS", Done, High, 2, webEng, webBlog, -5);
        T(web, "Export legacy blog posts", InProgress, Medium, 1, webContent, webBlog, 10);
        T(web, "Write redirect map", Todo, Medium, 1, webContent, webBlog, 20);
        T(web, "Image optimisation pipeline", Todo, High, 4, webEng, webPerf, 25);
        T(web, "Accessibility audit", Todo, Urgent, 3, webDesign, webPerf, -2, "Overdue: needs attention.");
        T(web, "Homepage copy", Review, Low, 1, webContent, webHome, 7);

        // Project 2: Mobile App v2
        var app = P("Mobile App v2", "Second major release of the customer mobile app with offline mode and push notifications.", ProjectStatus.Active, -60, 90, 2, 2, 3, 4);
        var appFront = G(app, "Frontend", "#FFD400", 3, 4);
        var appBack = G(app, "Backend", "#0A0A0A", 4, 2);
        var appQa = G(app, "QA", "#FFFFFF", 3);
        var appOffline = Go(app, "Offline mode", "Core screens usable without a connection.", 40);
        var appPush = Go(app, "Push notifications", "Reliable, preference-aware notifications.", 60);
        T(app, "Local data cache", Done, High, 4, appBack, appOffline, -15);
        T(app, "Sync conflict resolution", InProgress, Urgent, 4, appBack, appOffline, 12);
        T(app, "Offline banner UI", Done, Low, 3, appFront, appOffline, -8);
        T(app, "Queue writes while offline", Todo, High, 3, appFront, appOffline, 20);
        T(app, "Notification service", InProgress, High, 2, appBack, appPush, 25);
        T(app, "Preference screen", Todo, Medium, 3, appFront, appPush, 30);
        T(app, "Device matrix test plan", Review, Medium, 3, appQa, appPush, 15);
        T(app, "Crash reporting integration", Done, Medium, 4, appBack, null, -25);

        // Project 3: Internal Tooling
        var tool = P("Internal Tooling", "Replace spreadsheets and ad-hoc scripts with proper internal dashboards.", ProjectStatus.Planning, -5, 120, 1, 1, 2, 4);
        var toolPlat = G(tool, "Platform", "#FFD400", 4, 1);
        var toolOps = G(tool, "Ops", "#FFFFFF", 2);
        var toolDash = Go(tool, "Ops dashboard v1", "Single view for deployment and incident status.", 60);
        var toolAuto = Go(tool, "Automate onboarding", "New-starter accounts created automatically.", 100);
        T(tool, "Gather requirements", Done, Medium, 2, toolOps, toolDash, -3);
        T(tool, "Pick dashboard framework", InProgress, Medium, 4, toolPlat, toolDash, 7);
        T(tool, "Data source inventory", Todo, Low, 2, toolOps, toolDash, 14);
        T(tool, "Identity provider integration", Todo, High, 1, toolPlat, toolAuto, 45);
        T(tool, "Onboarding checklist spec", Todo, Medium, 2, toolOps, toolAuto, 30);

        SeedAgents(s, web, webContent, app, appQa);
    }

    // Demo AI agents. They are invisible to every client until an admin switches the AI feature on.
    private static void SeedAgents(DataStore s, Project web, Group webContent, Project app, Group appQa)
    {
        var scout = new User { Id = 5, Kind = UserKind.Agent, Name = "Scout", Email = "scout@agents.groupmonkey.local", Role = Role.Member, Color = "#0A0A0A" };
        var patch = new User { Id = 6, Kind = UserKind.Agent, Name = "Patch", Email = "patch@agents.groupmonkey.local", Role = Role.Member, Color = "#0A0A0A" };
        s.Users.AddRange([scout, patch]);

        s.Agents.Add(new AgentConfig
        {
            UserId = scout.Id, CreatedBy = 1, Autonomy = Autonomy.AskFirst,
            Description = "Research assistant that gathers context and writes up findings.",
            Instructions = "Research the topic using the project context. Structure findings with clear headings, state assumptions, and list open questions.",
            AllowedTools = [AgentTools.AddComment, AgentTools.UpdateTaskStatus, AgentTools.RequestHumanInput],
        });
        s.Agents.Add(new AgentConfig
        {
            UserId = patch.Id, CreatedBy = 1, Autonomy = Autonomy.Suggest,
            Description = "QA reviewer that checks work for gaps and risks. Comments only.",
            Instructions = "Produce a short checklist of things to verify and edge cases to test. Only comment; people decide what to change.",
            AllowedTools = [AgentTools.AddComment, AgentTools.RequestHumanInput],
        });

        web.MemberIds.AddRange([scout.Id, patch.Id]);
        app.MemberIds.AddRange([scout.Id, patch.Id]);
        webContent.MemberIds.Add(scout.Id);
        appQa.MemberIds.Add(patch.Id);

        var redirects = s.Tasks.First(t => t.Title == "Write redirect map");
        var matrix = s.Tasks.First(t => t.Title == "Device matrix test plan");
        redirects.AssigneeId = scout.Id;
        matrix.AssigneeId = patch.Id;

        var now = DateTime.UtcNow;

        // Scout: finished a run, and is waiting for a person to approve moving the card to Review.
        var scoutRun = new AgentRun
        {
            Id = s.NextRunId(), AgentId = scout.Id, TaskId = redirects.Id, ProjectId = web.Id, Status = RunStatus.AwaitingApproval,
            CreatedAt = now.AddMinutes(-42), StartedAt = now.AddMinutes(-42), EndedAt = now.AddMinutes(-41), Provider = "Mock",
            TriggeredBy = "Assigned by Ava Admin",
            Steps =
            [
                new() { Type = StepType.Thought, Content = "Demo data: a scripted example of what a run looks like.", At = now.AddMinutes(-42) },
                new() { Type = StepType.ToolCall, Content = "get_task {\"task_id\":" + redirects.Id + "}", At = now.AddMinutes(-42) },
                new() { Type = StepType.ToolResult, Content = "Task details returned.", At = now.AddMinutes(-42) },
                new() { Type = StepType.ToolCall, Content = "add_comment {\"task_id\":" + redirects.Id + "}", At = now.AddMinutes(-41) },
                new() { Type = StepType.ToolResult, Content = "Comment posted on task #" + redirects.Id + ".", At = now.AddMinutes(-41) },
            ],
        };
        s.Runs.Add(scoutRun);
        s.Comments.Add(new TaskComment
        {
            Id = s.NextCommentId(), TaskId = redirects.Id, AuthorId = scout.Id, CreatedAt = now.AddMinutes(-41),
            Body = "**Redirect map: first pass**\n\n- Group old URLs by section (blog, press, docs) so rules can be written per prefix.\n- Keep trailing-slash and lower-case variants as separate checks.\n- Open question: do archived posts keep their original dates in the new CMS?\n\n_Demo content generated for the seed data._",
        });
        var proposal = new ProposedAction
        {
            Id = s.NextActionId(), RunId = scoutRun.Id, AgentId = scout.Id, ProjectId = web.Id, TaskId = redirects.Id,
            Tool = AgentTools.UpdateTaskStatus, State = ActionState.Pending, CreatedAt = now.AddMinutes(-41),
            Args = new()
            {
                ["task_id"] = System.Text.Json.JsonSerializer.SerializeToElement(redirects.Id),
                ["status"] = System.Text.Json.JsonSerializer.SerializeToElement("Review"),
            },
            Summary = $"Move task #{redirects.Id} \"{redirects.Title}\" from Todo to Review",
        };
        s.Actions.Add(proposal);
        scoutRun.ActionIds.Add(proposal.Id);

        // Patch: reviewed a task and left a checklist.
        var patchRun = new AgentRun
        {
            Id = s.NextRunId(), AgentId = patch.Id, TaskId = matrix.Id, ProjectId = app.Id, Status = RunStatus.Succeeded,
            CreatedAt = now.AddHours(-3), StartedAt = now.AddHours(-3), EndedAt = now.AddHours(-3).AddMinutes(1), Provider = "Mock",
            TriggeredBy = "Assigned by Marcus Manager",
            Steps =
            [
                new() { Type = StepType.Thought, Content = "Demo data: a scripted example of what a run looks like.", At = now.AddHours(-3) },
                new() { Type = StepType.ToolCall, Content = "add_comment {\"task_id\":" + matrix.Id + "}", At = now.AddHours(-3) },
                new() { Type = StepType.ToolResult, Content = "Comment posted on task #" + matrix.Id + ".", At = now.AddHours(-3) },
            ],
        };
        s.Runs.Add(patchRun);
        s.Comments.Add(new TaskComment
        {
            Id = s.NextCommentId(), TaskId = matrix.Id, AuthorId = patch.Id, CreatedAt = now.AddHours(-3),
            Body = "**Test plan review**\n\n- [ ] Cover the two most recent OS versions and one older baseline on each platform.\n- [ ] Include a small-screen phone and a tablet.\n- [ ] Test offline mode with a flaky connection, not only airplane mode.\n- [ ] Confirm push permissions on first launch and after a reinstall.\n\n_Demo content generated for the seed data._",
        });
    }
}
