import { Route, Switch } from "wouter";
import Shell from "./shell/Shell";
import Home from "./pages/Home";
import NotFound from "./pages/NotFound";

function App() {
  return (
    <Shell>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </Shell>
  );
}

export default App;
