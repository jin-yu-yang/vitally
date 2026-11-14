// Stub so the stack starts: Task 4 of add-account-invitations replaces it.
Deno.serve(() =>
  new Response(JSON.stringify({ code: "SERVER_ERROR" }), {
    status: 501,
    headers: { "content-type": "application/json" },
  }));
