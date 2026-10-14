// Runs once when the server starts. With a misconfigured SMS panel the server answers every
// request, the health check included, with an error naming the setting, instead of failing
// later at a manager's login.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getSmsSender } = await import("./lib/sms");
  getSmsSender();
}
