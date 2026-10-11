import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

import "@/instrumentation-client";

hydrateRoot(document, <HydratedRouter />);
