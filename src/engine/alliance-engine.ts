import allianceData from "@/data/alliances.json";
import partyRelationshipData from "@/data/party-relationships.json";

import type {
  Alliance,
  AllianceConfiguration,
  AllianceActionResult,
  AllianceId,
  PoliticalRelationship,
  PartyMembership,
  PartyRelationshipData,
  RelationshipContext,
  ResolvedPoliticalRelationship,
} from "@/types/alliance";

const relationshipData =
  partyRelationshipData as PartyRelationshipData;

const HARD_BLOCK_RELATIONSHIPS: PoliticalRelationship[] = [
  "STRONG_RIVAL",
];

function getCanonicalPair(partyA: string, partyB: string): string {
  return [partyA, partyB].sort().join("|");
}

function normalizeRegionName(region: string): string {
  return region
    .trim()
    .toLowerCase()
    .replace(/\band\b/g, "&")
    .replace(/\s*&\s*/g, "&")
    .replace(/\s+/g, " ");
}

function ruleMatchesContext(
  rule: PartyRelationshipData["relationships"][number],
  context: RelationshipContext = {}
): boolean {
  const { type, regions, activation } = rule.scope;

  if (activation === "CONDITIONAL" && !context.activateConditionalRules) {
    return false;
  }

  switch (type) {
    case "GENERAL":
    case "NATIONAL":
      return true;

    case "STATES":
      return Boolean(
        context.region && regions?.some(
          (region) =>
            normalizeRegionName(region) === normalizeRegionName(context.region!)
        )
      );

    case "ALL_STATES":
      return context.electionType === "ASSEMBLY" && Boolean(context.region);

    default:
      return false;
  }
}

function getRulePriority(
  rule: PartyRelationshipData["relationships"][number]
): number {
  switch (rule.scope.type) {
    case "STATES":
      return 4;
    case "ALL_STATES":
      return 3;
    case "NATIONAL":
      return 2;
    case "GENERAL":
    default:
      return 1;
  }
}

/**
 * Resolve the relationship for a party pair.
 * Unlisted pairs resolve to NEUTRAL, as specified by party-relationships.json.
 * Relationships are symmetric.
 */
export function getPoliticalRelationship(
  partyA: string,
  partyB: string,
  context: RelationshipContext = {}
): ResolvedPoliticalRelationship {
  if (partyA === partyB) {
    return {
      relationship: "STRONG_ALLY",
      scope: "DEFAULT",
      conditional: false,
      applies: true,
    };
  }

  const pairKey = getCanonicalPair(partyA, partyB);

  const matchingRules = relationshipData.relationships
    .filter((rule) => getCanonicalPair(...rule.partyIds) === pairKey)
    .filter((rule) => ruleMatchesContext(rule, context))
    .sort((a, b) => getRulePriority(b) - getRulePriority(a));

  const selectedRule = matchingRules[0];

  if (!selectedRule) {
    return {
      relationship: relationshipData.defaultRelationship ?? "NEUTRAL",
      scope: "DEFAULT",
      conditional: false,
      applies: true,
    };
  }

  return {
    relationship: selectedRule.relationship,
    scope: selectedRule.scope.type,
    conditional: selectedRule.scope.activation === "CONDITIONAL",
    applies: true,
  };
}

/** Initialize alliance memberships from the predefined core-party lists. */
export function initializeAlliances(
  allPartyIds: string[]
): AllianceConfiguration {
  const alliances = allianceData.alliances as Alliance[];

  const memberships: PartyMembership[] = allPartyIds.map((partyId) => {
    const alliance = alliances.find((item) =>
      item.corePartyIds.includes(partyId)
    );

    return {
      partyId,
      allianceId: alliance?.id ?? null,
      status: alliance ? "CORE" : "INDEPENDENT",
    };
  });

  return { alliances, memberships };
}

/** Find a party's current membership. */
export function getPartyMembership(
  configuration: AllianceConfiguration,
  partyId: string
): PartyMembership | undefined {
  return configuration.memberships.find(
    (membership) => membership.partyId === partyId
  );
}

/** Move a party out of its current alliance and make it independent. */
export function leaveAlliance(
  configuration: AllianceConfiguration,
  partyId: string
): AllianceActionResult {
  const membership = getPartyMembership(configuration, partyId);

  if (!membership) {
    return { success: false, message: "Party does not exist in this game." };
  }

  if (!membership.allianceId) {
    return { success: false, message: "This party is already independent." };
  }

  const updatedMemberships = configuration.memberships.map((item) =>
    item.partyId === partyId
      ? { ...item, allianceId: null, status: "INDEPENDENT" as const }
      : item
  );

  return {
    success: true,
    configuration: { ...configuration, memberships: updatedMemberships },
    message: `${partyId} has left its alliance and is now independent.`,
  };
}

function inspectPartyAgainstAlliance(
  configuration: AllianceConfiguration,
  partyId: string,
  allianceId: AllianceId,
  context: RelationshipContext = {}
): { errors: string[]; warnings: string[] } {
  const targetAlliance = configuration.alliances.find(
    (item) => item.id === allianceId
  );

  if (!targetAlliance) {
    return { errors: ["The selected alliance does not exist."], warnings: [] };
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  const existingMembers = configuration.memberships.filter(
    (item) => item.allianceId === allianceId && item.partyId !== partyId
  );

  for (const member of existingMembers) {
    const resolved = getPoliticalRelationship(
      partyId,
      member.partyId,
      context
    );

    if (
      HARD_BLOCK_RELATIONSHIPS.includes(resolved.relationship) ||
      (resolved.relationship === "RIVAL" && !resolved.conditional)
    ) {
      errors.push(
        `${partyId} cannot join with ${member.partyId}: ${
          resolved.relationship === "STRONG_RIVAL" ? "STRONG_RIVAL" : "RIVAL"
        } applies in this election context.`
      );
    } else if (resolved.relationship === "RIVAL" && resolved.conditional) {
      warnings.push(
        `${partyId} and ${member.partyId} have an activated conditional rivalry; an explicit political agreement is required.`
      );
    }
  }

  return { errors, warnings };
}

/**
 * A party must first leave its existing alliance.
 * Unconditional RIVAL and STRONG_RIVAL relationships block electoral alliance membership.
 * An activated CONDITIONAL RIVAL can proceed only with a negotiation warning.
 */
export function joinAlliance(
  configuration: AllianceConfiguration,
  partyId: string,
  targetAllianceId: AllianceId,
  context: RelationshipContext = {}
): AllianceActionResult {
  const membership = getPartyMembership(configuration, partyId);

  if (!membership) {
    return { success: false, message: "Party does not exist in this game." };
  }

  if (membership.allianceId) {
    return {
      success: false,
      message:
        "This party must leave its current alliance before joining another.",
    };
  }

  const compatibility = inspectPartyAgainstAlliance(
    configuration,
    partyId,
    targetAllianceId,
    context
  );

  if (compatibility.errors.length > 0) {
    return {
      success: false,
      message: compatibility.errors.join(" "),
      warnings: compatibility.warnings,
    };
  }

  const targetAlliance = configuration.alliances.find(
    (item) => item.id === targetAllianceId
  )!;

  const updatedMemberships = configuration.memberships.map((item) =>
    item.partyId === partyId
      ? {
          ...item,
          allianceId: targetAllianceId,
          status: "PARTNER" as const,
        }
      : item
  );

  return {
    success: true,
    configuration: { ...configuration, memberships: updatedMemberships },
    message: compatibility.warnings.length
      ? `${partyId} joined ${targetAlliance.name} after political negotiation.`
      : `${partyId} has joined ${targetAlliance.name}.`,
    warnings: compatibility.warnings,
  };
}

/**
 * Create a custom electoral alliance.
 * Every proposed party is checked against every other proposed party.
 */
export function createCustomAlliance(
  configuration: AllianceConfiguration,
  allianceName: string,
  partyIds: string[],
  context: RelationshipContext = {}
): AllianceActionResult {
  const name = allianceName.trim();

  if (!name) {
    return { success: false, message: "Please provide an alliance name." };
  }

  if (
    configuration.alliances.some(
      (item) => item.name.toLowerCase() === name.toLowerCase()
    )
  ) {
    return {
      success: false,
      message: "An alliance with this name already exists.",
    };
  }

  if (partyIds.length < 2) {
    return {
      success: false,
      message: "An alliance requires at least two parties.",
    };
  }

  if (new Set(partyIds).size !== partyIds.length) {
    return { success: false, message: "Duplicate parties are not allowed." };
  }

  for (const partyId of partyIds) {
    const membership = getPartyMembership(configuration, partyId);

    if (!membership) {
      return {
        success: false,
        message: `${partyId} does not exist in this game.`,
      };
    }

    if (membership.allianceId) {
      return {
        success: false,
        message: `${partyId} must leave its current alliance first.`,
      };
    }
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < partyIds.length; i++) {
    for (let j = i + 1; j < partyIds.length; j++) {
      const resolved = getPoliticalRelationship(
        partyIds[i],
        partyIds[j],
        context
      );

      if (
        HARD_BLOCK_RELATIONSHIPS.includes(resolved.relationship) ||
        (resolved.relationship === "RIVAL" && !resolved.conditional)
      ) {
        errors.push(
          `${partyIds[i]} and ${partyIds[j]} have a ${
            resolved.relationship === "STRONG_RIVAL" ? "STRONG_RIVAL" : "RIVAL"
          } relationship in this election context.`
        );
      } else if (resolved.relationship === "RIVAL" && resolved.conditional) {
        warnings.push(
          `${partyIds[i]} and ${partyIds[j]} have an activated conditional rivalry; political negotiation is needed.`
        );
      }
    }
  }

  if (errors.length > 0) {
    return { success: false, message: errors.join(" "), warnings };
  }

  const newAlliance: Alliance = {
    id: `CUSTOM_${Date.now()}`,
    name,
    type: "CUSTOM",
    membershipType: "EDITABLE",
    corePartyIds: [],
  };

  const updatedMemberships = configuration.memberships.map((item) =>
    partyIds.includes(item.partyId)
      ? {
          ...item,
          allianceId: newAlliance.id,
          status: "PARTNER" as const,
        }
      : item
  );

  return {
    success: true,
    configuration: {
      alliances: [...configuration.alliances, newAlliance],
      memberships: updatedMemberships,
    },
    message: warnings.length
      ? `${name} has been created after political negotiation.`
      : `${name} has been created successfully.`,
    warnings,
  };
}
