import type { CSSProperties, ReactNode } from "react";

/** Shortens the workspace scope so chips stay readable, mirroring the react-native-wallet example. */
function packageLabel(name: string): string {
  return name.replace("@algorandfoundation/", "");
}

interface DomainSectionProps {
  title: string;
  description: string;
  /** Accent color of the domain, same palette as the react-native-wallet example. */
  color: string;
  /** The packages this domain runs on, rendered as chips under the header. */
  packages: string[];
  children: ReactNode;
}

/**
 * A domain block mirroring the react-native-wallet example's home screen:
 * a colored letter icon, the domain title and description, a package-count
 * badge, and chips naming the packages in use for the domain, followed by
 * the domain's panels.
 */
export function DomainSection({
  title,
  description,
  color,
  packages,
  children,
}: DomainSectionProps) {
  return (
    <section className="domain" style={{ "--domain-color": color } as CSSProperties}>
      <header className="domain-header">
        <div className="domain-icon">{title.charAt(0)}</div>
        <div className="domain-heading">
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <span className="domain-badge">{packages.length} pkg</span>
      </header>
      <div className="domain-packages">
        {packages.map((pkg) => (
          <span key={pkg} className="package-chip" title={pkg}>
            {packageLabel(pkg)}
          </span>
        ))}
      </div>
      <div className="domain-panels">{children}</div>
    </section>
  );
}
