import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

import { installGlobalErrorReporting } from "@/lib/error-report";

installGlobalErrorReporting();

hydrateRoot(document, <HydratedRouter />);
