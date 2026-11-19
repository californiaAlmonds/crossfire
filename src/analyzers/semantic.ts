import type { AnalyzeSemanticCollisionsFn, ChangedFileDelta, CollisionFinding, ExportedSymbol, SymbolReference } from '../types.js';
import { makeFindingId, sortFindings } from '../utils.js';
import { extractExportedSymbols, extractSymbolReferences } from './symbols.js';

export const analyzeSemanticCollisions: AnalyzeSemanticCollisionsFn = async (ctx, lookupFile) => {
  const findings: CollisionFinding[] = [];

  const getExports = (delta: ChangedFileDelta, content: string | null) => {
    if (delta.isBinary || !content) return [];
    return extractExportedSymbols(delta.path, content);
  };
  
  const getRefs = (delta: ChangedFileDelta, content: string | null) => {
    if (delta.isBinary || !content) return [];
    return extractSymbolReferences(delta.path, content);
  };

  const processDirection = (
    deltasP: ChangedFileDelta[], deltasC: ChangedFileDelta[], 
    unitP: string, unitC: string
  ) => {
    const pBaseExports = new Map<string, ExportedSymbol[]>();
    const pHeadExports = new Map<string, ExportedSymbol[]>();
    
    for (const d of deltasP) {
      pBaseExports.set(d.path, getExports(d, d.baseContent));
      pHeadExports.set(d.path, getExports(d, d.headContent));
    }

    const cHeadRefs = new Map<string, SymbolReference[]>();
    const cHeadExports = new Map<string, ExportedSymbol[]>();
    for (const d of deltasC) {
      cHeadRefs.set(d.path, getRefs(d, d.headContent));
      cHeadExports.set(d.path, getExports(d, d.headContent));
    }

    // 1 & 2: DELETED_EXPORT_REFERENCED & RENAMED_EXPORT_STALE_REF
    for (const [pPath, baseExps] of pBaseExports) {
      const headExps = pHeadExports.get(pPath) || [];
      for (const baseExp of baseExps) {
        const stillExists = headExps.find(e => e.name === baseExp.name);
        if (!stillExists) {
          // Look for references in consumer
          for (const [cPath, refs] of cHeadRefs) {
            const staleRefs = refs.filter(r => r.name === baseExp.name);
            for (const ref of staleRefs) {
              const renamed = headExps.find(e => e.kind === baseExp.kind);
              const rule = renamed ? 'RENAMED_EXPORT_STALE_REF' : 'DELETED_EXPORT_REFERENCED';
              findings.push({
                id: makeFindingId({ layer: 'semantic', rule, unitA: unitP, unitB: unitC, files: [pPath, cPath], detail: baseExp.name }),
                layer: 'semantic', rule, severity: 'critical',
                unitA: unitP, unitB: unitC, files: [pPath, cPath],
                lineA: baseExp.line, lineB: ref.line,
                summary: `Export ${baseExp.name} was ${renamed ? 'renamed' : 'removed'} by ${unitP}, but referenced by ${unitC}`,
                evidence: renamed ? `Possible rename to: ${renamed.name}` : `Removed export: ${baseExp.name}`,
                remediation: `Update ${cPath} to use the new contract in ${pPath}`
              });
            }
          }
        } else {
          // 3. SIGNATURE_ARITY_BREAK
          if ((baseExp.kind === 'function' || baseExp.kind === 'class') && (stillExists.kind === 'function' || stillExists.kind === 'class')) {
             const bMin = baseExp.minArgs ?? 0;
             const bMax = baseExp.maxArgs ?? Infinity;
             const hMin = stillExists.minArgs ?? 0;
             const hMax = stillExists.maxArgs ?? Infinity;
             if (hMin > bMin || hMax < bMax) {
                for (const [cPath, refs] of cHeadRefs) {
                   const calls = refs.filter(r => r.name === baseExp.name && r.kind === 'call' && r.argCount !== undefined);
                   for (const call of calls) {
                      if (call.argCount! < hMin || call.argCount! > (stillExists.maxArgs === null ? Infinity : stillExists.maxArgs!)) {
                         findings.push({
                           id: makeFindingId({ layer: 'semantic', rule: 'SIGNATURE_ARITY_BREAK', unitA: unitP, unitB: unitC, files: [pPath, cPath], detail: baseExp.name }),
                           layer: 'semantic', rule: 'SIGNATURE_ARITY_BREAK', severity: 'critical',
                           unitA: unitP, unitB: unitC, files: [pPath, cPath],
                           lineA: stillExists.line, lineB: call.line,
                           summary: `Arity break on ${baseExp.name} (${hMin}-${stillExists.maxArgs ?? 'any'} args) by ${unitP}, called with ${call.argCount} args in ${unitC}`,
                           evidence: stillExists.rawSignature,
                           remediation: `Update call site in ${cPath} to match new signature.`
                         });
                      }
                   }
                }
             }
          }

          // 4. TYPE_CONTRACT_DRIFT
          if (['interface', 'type', 'class'].includes(baseExp.kind)) {
             const baseFields = new Set(baseExp.fields || []);
             const headFields = stillExists.fields || [];
             let drift = false;
             // Added required field or removed base field
             for (const f of headFields) { if (!baseFields.has(f)) drift = true; }
             for (const f of baseFields) { if (!headFields.includes(f)) drift = true; }
             
             if (drift) {
                for (const [cPath, refs] of cHeadRefs) {
                   const typeRefs = refs.filter(r => r.name === baseExp.name && r.kind === 'type_ref');
                   for (const ref of typeRefs) {
                      findings.push({
                         id: makeFindingId({ layer: 'semantic', rule: 'TYPE_CONTRACT_DRIFT', unitA: unitP, unitB: unitC, files: [pPath, cPath], detail: baseExp.name }),
                         layer: 'semantic', rule: 'TYPE_CONTRACT_DRIFT', severity: 'high',
                         unitA: unitP, unitB: unitC, files: [pPath, cPath],
                         lineA: stillExists.line, lineB: ref.line,
                         summary: `Type ${baseExp.name} modified by ${unitP}, used by ${unitC}`,
                         evidence: stillExists.rawSignature,
                         remediation: `Ensure ${cPath} correctly constructs/consumes ${baseExp.name}`
                      });
                   }
                }
             }
          }
        }
      }
    }

    // 5. DUPLICATE_ROUTE_OR_EXPORT
    for (const [pPath, pExps] of pHeadExports) {
       const pDelta = deltasP.find(d => d.path === pPath)!;
       const pBaseExps = pDelta.baseContent ? getExports(pDelta, pDelta.baseContent) : [];
       
       for (const pExp of pExps) {
          if (!pBaseExps.find(e => e.name === pExp.name && e.kind === pExp.kind)) {
             // Added in P. Did C also add it?
             for (const [cPath, cExps] of cHeadExports) {
                const cDelta = deltasC.find(d => d.path === cPath)!;
                const cBaseExps = cDelta.baseContent ? getExports(cDelta, cDelta.baseContent) : [];
                
                const duplicate = cExps.find(e => e.name === pExp.name && e.kind === pExp.kind);
                if (duplicate && !cBaseExps.find(e => e.name === duplicate.name && e.kind === duplicate.kind)) {
                   if (pExp.kind === 'route' || pPath === cPath) { // same route anywhere, or same export in same shared barrel
                      findings.push({
                         id: makeFindingId({ layer: 'semantic', rule: 'DUPLICATE_ROUTE_OR_EXPORT', unitA: unitP, unitB: unitC, files: [pPath, cPath], detail: pExp.name }),
                         layer: 'semantic', rule: 'DUPLICATE_ROUTE_OR_EXPORT', severity: 'high',
                         unitA: unitP, unitB: unitC, files: [pPath, cPath],
                         lineA: pExp.line, lineB: duplicate.line,
                         summary: `Both units independently added the same ${pExp.kind}: ${pExp.name}`,
                         evidence: `Unit A added in ${pPath}, Unit B added in ${cPath}`,
                         remediation: `Deduplicate or coordinate the addition of ${pExp.name}`
                      });
                   }
                }
             }
          }
       }
    }
  };

  processDirection(ctx.deltasA, ctx.deltasB, ctx.unitA.id, ctx.unitB.id);
  processDirection(ctx.deltasB, ctx.deltasA, ctx.unitB.id, ctx.unitA.id);

  // Deduplicate
  const uniqueFindings = new Map<string, CollisionFinding>();
  for (const f of findings) {
    if (!uniqueFindings.has(f.id)) {
      uniqueFindings.set(f.id, f);
    }
  }

  return sortFindings(Array.from(uniqueFindings.values()));
};
