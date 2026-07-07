import process from "node:process";

// Helper to get API key from MCP config
function getApiKey(): string {
  const apiKey = process.env.CLOCKIFY_API_KEY;
  if (!apiKey) {
    throw new Error("CLOCKIFY_API_KEY is not set in MCP config.");
  }
  return apiKey;
}

// Helper to call Clockify API
async function clockifyFetch(endpoint: string, options: RequestInit = {}) {
  const apiKey = getApiKey();
  const baseUrl = "https://api.clockify.me/api/v1";
  const url = endpoint.startsWith("http") ? endpoint : `${baseUrl}${endpoint}`;
  const headers = {
    "X-Api-Key": apiKey,
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  const response = await fetch(url, { ...options, headers });

  if (!response.ok) {
    const text = await response.text();
    console.error(
      `[Error] Clockify API ${url} failed: ${response.status} ${text}`,
    );
    throw new Error(`Clockify API error: ${response.status} ${text}`);
  }
  return response.json();
}

// Helper to convert Clockify's cent-based amounts into real currency units.
// Skips customFieldValues/userCustomFieldValues entirely, since those carry
// arbitrary numeric fields (Company ID, HubSpot Deal ID, etc.) that are NOT
// currency and must never be divided.
function convertCentsToCurrency(obj: unknown, parentKey?: string): unknown {
  if (parentKey === "customFieldValues" || parentKey === "userCustomFieldValues") {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => convertCentsToCurrency(item, parentKey));
  }
  if (obj && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      if (
        (key === "amount" || key === "value" || key === "totalAmount") &&
        typeof val === "number"
      ) {
        result[key] = val / 100;
      } else {
        result[key] = convertCentsToCurrency(val, key);
      }
    }
    return result;
  }
  return obj;
}

// Handler for listing available tools
export async function listToolsHandler() {
  return {
    tools: [
      {
        name: "listProjects",
        description:
          "List all projects for the authenticated user. Automatically fetches all pages, so archived and less-recent projects are always included. Optional: archived, name (unverified query params - let us know if they don't filter as expected).",
        inputSchema: {
          type: "object",
          properties: {
            archived: {
              type: "boolean",
              description: "Filter to archived (true) or active (false) projects only (optional, unverified).",
            },
            name: {
              type: "string",
              description: "Filter projects containing this string in their name (optional, unverified).",
            },
          },
          required: [],
        },
      },
      {
        name: "getTimeEntries",
        description:
          "List time entries for the authenticated user. Optional: start, end (ISO8601).",
        inputSchema: {
          type: "object",
          properties: {
            start: {
              type: "string",
              description: "Start date (ISO8601, optional)",
            },
            end: {
              type: "string",
              description: "End date (ISO8601, optional)",
            },
          },
          required: [],
        },
      },
      {
        name: "addTimeEntry",
        description: "Add a time entry to a project.",
        inputSchema: {
          type: "object",
          properties: {
            projectId: { type: "string", description: "Clockify project ID" },
            description: {
              type: "string",
              description: "Description of the time entry",
            },
            start: { type: "string", description: "Start time (ISO8601)" },
            end: { type: "string", description: "End time (ISO8601)" },
            billable: {
              type: "boolean",
              description: "Whether this entry is billable (optional)",
            },
            taskId: {
              type: "string",
              description: "Clockify task ID to attach this entry to (optional)",
            },
            tagIds: {
              type: "array",
              items: { type: "string" },
              description: "Array of tag IDs to attach to this entry (optional)",
            },
          },
          required: ["projectId", "description", "start", "end"],
        },
      },
      {
        name: "listUsers",
        description:
          "List all users in the workspace. Optional: status (PENDING, ACTIVE, DECLINED, INACTIVE, or ALL - defaults to Clockify's default filter if omitted).",
        inputSchema: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: ["PENDING", "ACTIVE", "DECLINED", "INACTIVE", "ALL"],
              description: "Filter users by membership status (optional)",
            },
          },
          required: [],
        },
      },
      {
        name: "getUserTimeEntries",
        description:
          "List time entries for a specified user. Optional: start, end (ISO8601).",
        inputSchema: {
          type: "object",
          properties: {
            userId: { type: "string", description: "User ID" },
            start: {
              type: "string",
              description: "Start date (ISO8601, optional)",
            },
            end: {
              type: "string",
              description: "End date (ISO8601, optional)",
            },
          },
          required: ["userId"],
        },
      },
      {
        name: "getSummaryReport",
        description:
          "Get a summary report of hours grouped by project/user/client/etc. Defaults to Jan 1, 2025 onward. Monetary amounts are returned in real currency units (already converted from cents). Optional: userIds, projectIds, groups (1-3 of PROJECT, USER, CLIENT, TASK, TAG, DATE; defaults to [\"PROJECT\"]).",
        inputSchema: {
          type: "object",
          properties: {
            start: { type: "string", description: "Start date (ISO8601). Never goes earlier than 2025-01-01." },
            end: { type: "string", description: "End date (ISO8601). Defaults to today if omitted." },
            userIds: { type: "array", items: { type: "string" }, description: "Array of user IDs (optional)" },
            projectIds: { type: "array", items: { type: "string" }, description: "Array of project IDs (optional)" },
            groups: {
              type: "array",
              items: { type: "string", enum: ["PROJECT", "USER", "CLIENT", "TASK", "TAG", "DATE", "TIMEENTRY"] },
              description: "1-3 grouping levels, e.g. [\"CLIENT\"] or [\"CLIENT\",\"USER\"]. Defaults to [\"PROJECT\"].",
            },
          },
          required: [],
        },
      },
      {
        name: "getUserTimeEntriesByName",
        description:
          "List time entries for a user by name (case-insensitive, partial match allowed). Optional: start, end (ISO8601).",
        inputSchema: {
          type: "object",
          properties: {
            userName: {
              type: "string",
              description: "User name (partial/case-insensitive)",
            },
            start: {
              type: "string",
              description: "Start date (ISO8601, optional)",
            },
            end: {
              type: "string",
              description: "End date (ISO8601, optional)",
            },
          },
          required: ["userName"],
        },
      },
    ],
  };
}

interface MCPCallToolRequest {
  params: {
    name: string;
    arguments?: Record<string, unknown>;
  };
}

// Handler for calling a tool
export async function callToolHandler(request: MCPCallToolRequest) {
  // Get user info (needed for workspace and userId)
  const user = await clockifyFetch("/user");
  const workspaceId = user.activeWorkspace;
  const userId = user.id;

  switch (request.params.name) {
    case "listProjects": {
      const { archived, name } = request.params.arguments || {};
      const allProjects: unknown[] = [];
      let page = 1;
      const pageSize = 200;
      const MAX_PAGES = 25; // safety cap: ~5000 projects, avoids a runaway loop

      while (page <= MAX_PAGES) {
        const params = [`page=${page}`, `page-size=${pageSize}`];
        if (typeof archived === "boolean") params.push(`archived=${archived}`);
        if (typeof name === "string" && name) params.push(`name=${encodeURIComponent(name)}`);
        const url = `/workspaces/${workspaceId}/projects?${params.join("&")}`;
        const pageResults = await clockifyFetch(url);
        if (!Array.isArray(pageResults) || pageResults.length === 0) break;
        allProjects.push(...pageResults);
        if (pageResults.length < pageSize) break;
        page += 1;
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(convertCentsToCurrency(allProjects), null, 2),
          },
        ],
      };
    }
    case "getTimeEntries": {
      const { start, end } = request.params.arguments || {};
      let url = `/workspaces/${workspaceId}/user/${userId}/time-entries`;
      const params = [];
      if (typeof start === "string" && start)
        params.push(`start=${encodeURIComponent(start)}`);
      if (typeof end === "string" && end)
        params.push(`end=${encodeURIComponent(end)}`);
      if (params.length) url += `?${params.join("&")}`;
      const entries = await clockifyFetch(url);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(convertCentsToCurrency(entries), null, 2),
          },
        ],
      };
    }
    case "addTimeEntry": {
      const { projectId, description, start, end, billable, taskId, tagIds } =
        request.params.arguments || {};
      if (!projectId || !description || !start || !end) {
        throw new Error("projectId, description, start, and end are required");
      }
      const body = {
        start,
        end,
        description,
        projectId,
        ...(typeof billable === "boolean" ? { billable } : {}),
        ...(typeof taskId === "string" && taskId ? { taskId } : {}),
        ...(Array.isArray(tagIds) && tagIds.length ? { tagIds } : {}),
      };
      const entry = await clockifyFetch(
        `/workspaces/${workspaceId}/time-entries`,
        {
          method: "POST",
          body: JSON.stringify(body),
        },
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(convertCentsToCurrency(entry), null, 2),
          },
        ],
      };
    }
    case "listUsers": {
      const { status } = request.params.arguments || {};
      let url = `/workspaces/${workspaceId}/users`;
      if (typeof status === "string" && status) {
        url += `?status=${encodeURIComponent(status)}`;
      }
      const users = await clockifyFetch(url);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(convertCentsToCurrency(users), null, 2),
          },
        ],
      };
    }
    case "getUserTimeEntries": {
      const {
        userId: targetUserId,
        start,
        end,
      } = request.params.arguments || {};
      if (!targetUserId) {
        throw new Error("userId is required");
      }
      let url = `/workspaces/${workspaceId}/user/${targetUserId}/time-entries`;
      const params = [];
      if (typeof start === "string" && start)
        params.push(`start=${encodeURIComponent(start)}`);
      if (typeof end === "string" && end)
        params.push(`end=${encodeURIComponent(end)}`);
      if (params.length) url += `?${params.join("&")}`;
      const entries = await clockifyFetch(url);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(convertCentsToCurrency(entries), null, 2),
          },
        ],
      };
    }
    case "getSummaryReport": {
      const { start, end, userIds, projectIds, groups } =
        request.params.arguments || {};

      const MIN_START = "2025-01-01T00:00:00.000Z";
      const requestedStart = start || MIN_START;
      const effectiveStart = requestedStart < MIN_START ? MIN_START : requestedStart;
      const effectiveEnd = end || new Date().toISOString();
      const effectiveGroups =
        Array.isArray(groups) && groups.length > 0 ? groups : ["PROJECT"];

      const body = {
        dateRangeStart: effectiveStart,
        dateRangeEnd: effectiveEnd,
        exportType: "JSON",
        summaryFilter: {
          groups: effectiveGroups,
        },
        users: Array.isArray(userIds) && userIds.length
          ? { ids: userIds, contains: "CONTAINS", status: "ALL" }
          : undefined,
        projects: Array.isArray(projectIds) && projectIds.length
          ? { ids: projectIds, contains: "CONTAINS", status: "ALL" }
          : undefined,
        sortOrder: "ASCENDING",
      };
      const report = await clockifyFetch(
        `https://reports.api.clockify.me/v1/workspaces/${workspaceId}/reports/summary`,
        {
          method: "POST",
          body: JSON.stringify(body),
        },
      );
      const normalizedReport = convertCentsToCurrency(report);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(normalizedReport, null, 2),
          },
        ],
      };
    }
    case "getUserTimeEntriesByName": {
      const { userName, start, end } = request.params.arguments || {};
      if (!userName || typeof userName !== "string") {
        throw new Error("userName is required");
      }
      // Fetch users
      const users = await clockifyFetch(`/workspaces/${workspaceId}/users`);
      // Define a type for user
      type User = { id: string; name: string };
      // Find user by name (case-insensitive, partial match)
      const userMatch = (users as User[]).find(
        (u) => u.name && u.name.toLowerCase().includes(userName.toLowerCase()),
      );
      if (!userMatch) {
        throw new Error(`No user found matching name: ${userName}`);
      }
      let url = `/workspaces/${workspaceId}/user/${userMatch.id}/time-entries`;
      const params = [];
      if (typeof start === "string" && start)
        params.push(`start=${encodeURIComponent(start)}`);
      if (typeof end === "string" && end)
        params.push(`end=${encodeURIComponent(end)}`);
      if (params.length) url += `?${params.join("&")}`;
      const entries = await clockifyFetch(url);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(convertCentsToCurrency(entries), null, 2),
          },
        ],
      };
    }
    default:
      throw new Error("Unknown tool");
  }
}

export { getApiKey, clockifyFetch };