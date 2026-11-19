import type { ScanReport } from '../types.js';

export function renderSarifReport(report: ScanReport): string {
  // Collect unique rules
  const ruleMap = new Map<
    string,
    {
      id: string;
      name: string;
      shortDescription: { text: string };
      fullDescription: { text: string };
      defaultConfiguration: { level: 'error' | 'warning' | 'note' };
      help: { text: string };
    }
  >();

  for (const f of report.findings) {
    if (!ruleMap.has(f.rule)) {
      const defaultLevel: 'error' | 'warning' | 'note' =
        f.severity === 'critical' || f.severity === 'high'
          ? 'error'
          : f.severity === 'medium'
            ? 'warning'
            : 'note';

      const readableName = f.rule
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/\b\w/g, (c) => c.toUpperCase());

      ruleMap.set(f.rule, {
        id: f.rule,
        name: f.rule,
        shortDescription: {
          text: readableName,
        },
        fullDescription: {
          text: `Crossfire collision detection rule: ${f.rule} in layer ${f.layer}.`,
        },
        defaultConfiguration: {
          level: defaultLevel,
        },
        help: {
          text: `Rule ${f.rule} detected a ${f.severity} collision between parallel Git worktrees or branches. Refer to Crossfire documentation for remediation advice.`,
        },
      });
    }
  }

  const rules = Array.from(ruleMap.values());

  const results = report.findings.map((f) => {
    const level: 'error' | 'warning' | 'note' =
      f.severity === 'critical' || f.severity === 'high'
        ? 'error'
        : f.severity === 'medium'
          ? 'warning'
          : 'note';

    const uri = f.files[0] ?? 'REPO_ROOT';
    const physicalLocation: {
      artifactLocation: { uri: string; uriBaseId?: string };
      region?: { startLine: number };
    } = {
      artifactLocation: {
        uri,
        uriBaseId: '%SRCROOT%',
      },
    };

    if (typeof f.lineA === 'number' && f.lineA >= 1) {
      physicalLocation.region = {
        startLine: f.lineA,
      };
    }

    let messageText = `${f.summary}\nCollision between ${f.unitA} and ${f.unitB}.`;
    if (f.remediation) {
      messageText += `\nRemediation: ${f.remediation}`;
    }
    if (f.evidence) {
      messageText += `\nEvidence:\n${f.evidence}`;
    }

    return {
      ruleId: f.rule,
      level,
      message: {
        text: messageText,
      },
      locations: [
        {
          physicalLocation,
        },
      ],
      properties: {
        findingId: f.id,
        layer: f.layer,
        severity: f.severity,
        unitA: f.unitA,
        unitB: f.unitB,
        files: f.files,
        evidence: f.evidence,
        remediation: f.remediation,
      },
    };
  });

  const sarif = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'Crossfire',
            version: report.toolVersion || '1.0.0',
            informationUri: 'https://github.com/crossfire-git/crossfire',
            rules,
          },
        },
        results,
      },
    ],
  };

  return JSON.stringify(sarif, null, 2);
}
