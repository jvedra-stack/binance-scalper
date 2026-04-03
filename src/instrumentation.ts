// Next.js instrumentation – spouští se jednou při startu serveru
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { autoStartBot } = await import("@/lib/bybit/auto-start");
    // Počkej 3s aby se server plně inicializoval
    setTimeout(() => {
      autoStartBot().catch(console.error);
    }, 3000);
  }
}
