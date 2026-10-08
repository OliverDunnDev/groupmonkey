using GroupMonkey.Api.Data;
using GroupMonkey.Api.Models;

namespace GroupMonkey.Api.Services;

public static class Progress
{
    public static int Percent(int done, int total) =>
        total == 0 ? 0 : (int)Math.Round(done * 100.0 / total, MidpointRounding.AwayFromZero);

    public static ProjectDto ToDto(DataStore s, Project p, User viewer)
    {
        var tasks = s.Tasks.Where(t => t.ProjectId == p.Id).ToList();
        var done = tasks.Count(t => t.Status == WorkStatus.Done);
        var group = s.GroupOf(p);
        var manage = Access.CanManage(s, viewer, p);
        return new ProjectDto(p.Id, p.Name, p.Description, p.Status, p.StartDate, p.DueDate, p.OwnerId,
            p.GroupId, group?.Name ?? "", s.Visible(s.MembersOf(p)), tasks.Count, done, Percent(done, tasks.Count), manage, manage);
    }

    public static GroupDto ToDto(DataStore s, Group g, User viewer)
    {
        var projectIds = s.Projects.Where(p => p.GroupId == g.Id).Select(p => p.Id).ToHashSet();
        var tasks = s.Tasks.Where(t => projectIds.Contains(t.ProjectId)).ToList();
        var done = tasks.Count(t => t.Status == WorkStatus.Done);
        return new GroupDto(g.Id, g.Name, g.Description, g.Color, g.OwnerId, s.Visible(g.MemberIds),
            projectIds.Count, tasks.Count, done, Percent(done, tasks.Count),
            Access.CanManageGroup(viewer, g), Access.CanEditGroup(viewer, g));
    }

    public static GoalDto ToDto(DataStore s, Goal g)
    {
        var tasks = s.Tasks.Where(t => t.GoalId == g.Id).ToList();
        var done = tasks.Count(t => t.Status == WorkStatus.Done);
        return new GoalDto(g.Id, g.ProjectId, g.Title, g.Description, g.TargetDate, tasks.Count, done, Percent(done, tasks.Count));
    }

    public static ProjectSummary Summarise(DataStore s, Project p)
    {
        var tasks = s.Tasks.Where(t => t.ProjectId == p.Id).ToList();
        var today = DateOnly.FromDateTime(DateTime.Today);
        var done = tasks.Count(t => t.Status == WorkStatus.Done);

        var byStatus = Enum.GetValues<WorkStatus>().ToDictionary(st => st, st => tasks.Count(t => t.Status == st));
        var members = s.Visible(s.MembersOf(p)).Select(uid =>
        {
            var mt = tasks.Where(t => t.AssigneeId == uid).ToList();
            var md = mt.Count(t => t.Status == WorkStatus.Done);
            var kind = s.IsAgent(uid) ? UserKind.Agent : UserKind.Human;
            return new MemberProgress(uid, mt.Count, md, Percent(md, mt.Count), kind);
        }).ToList();

        var overdue = tasks.Count(t => t.Status != WorkStatus.Done && t.DueDate is { } d && d < today);
        return new ProjectSummary(p.Id, tasks.Count, done, Percent(done, tasks.Count), overdue, byStatus, members);
    }
}
