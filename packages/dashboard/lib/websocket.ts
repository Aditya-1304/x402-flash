export function initWebSocket(): WebSocket {
  const ws = new WebSocket("ws://localhost:8080?type=dashboard");

  ws.onopen = () => {
    console.log("✓ Dashboard connected to facilitator");
  };

  ws.onerror = (error) => {
    console.error("WebSocket error:", error);
  };

  return ws;
}