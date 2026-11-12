export async function mockVisits(context) {
  await context.route("**/api/visits", (route) =>
    route.fulfill({
      json: {
        today: 12,
        total: 345,
        date: new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Shanghai",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date()),
        startedAt: "2026-11-12",
      },
    }),
  );
}
