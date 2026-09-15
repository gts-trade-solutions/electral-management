/**
 * Custody state machine: how one custody event moves an asset. Pure, so the
 * hand-off commands and the seed apply exactly the same transitions.
 */
import { AssetState, CustodyEventType, FacilityType } from "./types";

export type AssetPosition = {
  state: AssetState;
  currentFacilityId: string | null;
  currentTripId: string | null;
};

export type CustodyStep =
  | { type: typeof CustodyEventType.INTAKE; toFacilityId: string }
  | { type: typeof CustodyEventType.LOAD; tripId: string; fromFacilityId: string }
  | {
      type: typeof CustodyEventType.RECEIVE;
      tripId: string;
      toFacilityId: string;
      toFacilityType: FacilityType;
      tripOriginType: FacilityType;
    }
  | { type: typeof CustodyEventType.REPORT_MISSING };

/** The custody event columns a step fills in. */
export type CustodyColumns = {
  tripId: string | null;
  fromFacilityId: string | null;
  toFacilityId: string | null;
};

export class CustodyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustodyError";
  }
}

/** States in which an asset sits at a facility and can be loaded. */
export const AT_A_FACILITY: readonly AssetState[] = [AssetState.IN_WAREHOUSE, AssetState.AT_STATION, AssetState.RETURNED];

/**
 * Where the asset ends up after `step`, and which columns the event records.
 * `before` is null for an asset that has never been scanned.
 * Throws CustodyError when the step is not allowed from `before`.
 */
export function applyCustody(
  before: AssetPosition | null,
  step: CustodyStep,
): { after: AssetPosition; columns: CustodyColumns } {
  switch (step.type) {
    case CustodyEventType.INTAKE:
      if (before && before.state !== AssetState.MISSING) {
        throw new CustodyError(`Intake is for new or recovered assets; this one is ${before.state}`);
      }
      return {
        after: { state: AssetState.IN_WAREHOUSE, currentFacilityId: step.toFacilityId, currentTripId: null },
        columns: { tripId: null, fromFacilityId: null, toFacilityId: step.toFacilityId },
      };

    case CustodyEventType.LOAD:
      if (!before || !AT_A_FACILITY.includes(before.state)) {
        throw new CustodyError(`Can't load an asset that is ${before?.state ?? "not registered"}`);
      }
      if (before.currentFacilityId !== step.fromFacilityId) {
        throw new CustodyError("Asset is not at this trip's origin facility");
      }
      if (before.currentTripId !== null && before.currentTripId !== step.tripId) {
        throw new CustodyError("Asset is on another trip's manifest");
      }
      return {
        after: { state: AssetState.IN_TRANSIT, currentFacilityId: null, currentTripId: step.tripId },
        columns: { tripId: step.tripId, fromFacilityId: step.fromFacilityId, toFacilityId: null },
      };

    case CustodyEventType.RECEIVE: {
      if (!before || before.state !== AssetState.IN_TRANSIT || before.currentTripId !== step.tripId) {
        throw new CustodyError("Asset was not loaded on this trip");
      }
      const state =
        step.toFacilityType === FacilityType.VOTING_STATION
          ? AssetState.AT_STATION
          : step.tripOriginType === FacilityType.VOTING_STATION
            ? AssetState.RETURNED // station -> warehouse: the post-election return leg
            : AssetState.IN_WAREHOUSE;
      return {
        after: { state, currentFacilityId: step.toFacilityId, currentTripId: null },
        columns: { tripId: step.tripId, fromFacilityId: null, toFacilityId: step.toFacilityId },
      };
    }

    case CustodyEventType.REPORT_MISSING:
      if (!before || before.state === AssetState.MISSING) {
        throw new CustodyError(`Asset is ${before ? "already missing" : "not registered"}`);
      }
      return {
        after: { state: AssetState.MISSING, currentFacilityId: null, currentTripId: null },
        columns: { tripId: before.currentTripId, fromFacilityId: before.currentFacilityId, toFacilityId: null },
      };
  }
}
