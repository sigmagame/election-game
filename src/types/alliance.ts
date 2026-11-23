export type AllianceId = "NDA" | "INDIA" | string;

export type AllianceType = "PREDEFINED" | "CUSTOM";

export type PartyMembershipStatus =
  | "CORE"
  | "PARTNER"
  | "INDEPENDENT"
  | "NOT_PARTICIPATING";

export type PoliticalRelationship =
  | "STRONG_ALLY"
  | "FRIENDLY"
  | "NEUTRAL"
  | "RIVAL"
  | "STRONG_RIVAL"
  | "UNDEFINED";

export type RelationshipScopeType =
  | "GENERAL"
  | "NATIONAL"
  | "STATES"
  | "ALL_STATES";

export type RelationshipActivation = "CONDITIONAL";

export type ElectionType = "LOK_SABHA" | "ASSEMBLY";

export interface RelationshipScope {
  type: RelationshipScopeType;
  regions?: string[];
  activation?: RelationshipActivation;
}

export interface PartyRelationshipRule {
  partyIds: [string, string];
  relationship: Exclude<PoliticalRelationship, "UNDEFINED">;
  scope: RelationshipScope;
}

export interface PartyRelationshipData {
  schemaVersion: number;
  partyCount: number;
  uniqueUnorderedPairCount: number;
  defaultRelationship: PoliticalRelationship;
  relationshipTypes: PoliticalRelationship[];
  notes: string[];
  relationships: PartyRelationshipRule[];
}

export interface RelationshipContext {
  /** State/UT name, e.g. "Telangana" or "Jammu & Kashmir". */
  region?: string;
  electionType?: ElectionType;
  /** Set true only when a conditional rule is activated for this game scenario. */
  activateConditionalRules?: boolean;
}

export interface ResolvedPoliticalRelationship {
  relationship: PoliticalRelationship;
  scope: RelationshipScopeType | "DEFAULT";
  conditional: boolean;
  applies: boolean;
}

export interface Alliance {
  id: AllianceId;
  name: string;
  type: AllianceType;
  membershipType: "EDITABLE";
  corePartyIds: string[];
}

export interface PartyMembership {
  partyId: string;
  allianceId: AllianceId | null;
  status: PartyMembershipStatus;
}

export interface AllianceConfiguration {
  alliances: Alliance[];
  memberships: PartyMembership[];
}

export type AllianceActionResult =
  | {
      success: true;
      configuration: AllianceConfiguration;
      message: string;
      warnings?: string[];
    }
  | {
      success: false;
      message: string;
      warnings?: string[];
    };
