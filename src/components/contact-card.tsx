import { ArrowUpRight, Mail } from "lucide-react";

import { Card } from "@/components/ui/card";

const CONTACTS = [
  {
    label: "Email",
    value: "admin@lyjw.me",
    href: "mailto:admin@lyjw.me",
    icon: Mail,
    external: false,
  },
  {
    label: "GitHub",
    value: "LYJW131",
    href: "https://github.com/LYJW131",
    icon: GitHubIcon,
    external: true,
  },
] as const;

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M12 2C6.477 2 2 6.59 2 12.253c0 4.53 2.865 8.374 6.839 9.73.5.094.682-.222.682-.493 0-.244-.009-1.052-.014-1.91-2.782.62-3.369-1.209-3.369-1.209-.455-1.184-1.11-1.499-1.11-1.499-.908-.637.069-.624.069-.624 1.004.073 1.532 1.057 1.532 1.057.892 1.568 2.341 1.115 2.91.853.091-.663.349-1.115.635-1.371-2.221-.259-4.556-1.14-4.556-5.069 0-1.12.39-2.035 1.03-2.753-.104-.259-.447-1.302.097-2.714 0 0 .84-.276 2.75 1.051A9.303 9.303 0 0 1 12 6.986a9.32 9.32 0 0 1 2.504.345c1.909-1.327 2.748-1.051 2.748-1.051.545 1.412.202 2.455.099 2.714.64.718 1.029 1.633 1.029 2.753 0 3.939-2.339 4.807-4.566 5.061.359.318.678.942.678 1.899 0 1.372-.012 2.476-.012 2.813 0 .273.18.592.688.492C19.138 20.4 22 16.557 22 12.253 22 6.59 17.523 2 12 2Z" />
    </svg>
  );
}

export function ContactCard() {
  return (
    <Card id="contact" label="Contact" action="Say hello">
      <div className="grid min-h-44 grid-rows-2 divide-y divide-line px-4 pb-4 pt-3">
        {CONTACTS.map((contact) => {
          const Icon = contact.icon;
          return (
            <a
              key={contact.label}
              href={contact.href}
              target={contact.external ? "_blank" : undefined}
              rel={contact.external ? "noreferrer" : undefined}
              className="group flex min-w-0 items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
            >
              <div className="flex min-w-0 items-center gap-3">
                <Icon className="size-5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
                <div className="min-w-0">
                  <div className="label-mono text-muted-foreground">{contact.label}</div>
                  <div className="mt-1 truncate text-sm font-medium">{contact.value}</div>
                </div>
              </div>
              <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground" />
            </a>
          );
        })}
      </div>
    </Card>
  );
}
