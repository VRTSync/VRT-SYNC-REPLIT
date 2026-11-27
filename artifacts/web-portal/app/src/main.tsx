import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import "../../public/admin/admin.css";
import "../../public/portal/portal-ext.css";
import "./styles/shell.css";
import App from "./App";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: (count, err) => count < 2 && (err as { status?: number })?.status !== 401 && (err as { status?: number })?.status !== 403, refetchOnWindowFocus: false, staleTime: 30_000 },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Router base="/app">
        <App />
      </Router>
    </QueryClientProvider>
  </StrictMode>,
);
