export interface DefaultAddressRef {
  addressId: string;
  isDefault: boolean;
  updatedAt: string;
}

export interface DefaultAddressPlan {
  isDefault: boolean;
  clearAddressId?: string;
  promoteAddressId?: string;
  /** Undefined leaves the profile default unchanged. Null clears it. */
  defaultAddressId?: string | null;
}

function latest(addresses: DefaultAddressRef[]): DefaultAddressRef | undefined {
  return [...addresses].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  )[0];
}

export function planCreateDefault(input: {
  addressId: string;
  requestedDefault?: boolean;
  active: DefaultAddressRef[];
  currentDefaultAddressId?: string;
}): DefaultAddressPlan {
  const currentDefault = input.active.find((address) => address.isDefault);
  const becomesDefault =
    input.requestedDefault === true || currentDefault === undefined;

  if (!becomesDefault) {
    return {
      isDefault: false,
      defaultAddressId: input.currentDefaultAddressId,
    };
  }

  return {
    isDefault: true,
    clearAddressId:
      currentDefault && currentDefault.addressId !== input.addressId
        ? currentDefault.addressId
        : undefined,
    defaultAddressId: input.addressId,
  };
}

export function planUpdateDefault(input: {
  addressId: string;
  wasDefault: boolean;
  requestedDefault?: boolean;
  activeOthers: DefaultAddressRef[];
  currentDefaultAddressId?: string;
}): DefaultAddressPlan {
  if (input.requestedDefault === undefined) {
    return {
      isDefault: input.wasDefault,
      defaultAddressId: input.currentDefaultAddressId,
    };
  }

  if (input.requestedDefault) {
    const currentDefault = input.activeOthers.find((address) => address.isDefault);
    return {
      isDefault: true,
      clearAddressId: currentDefault?.addressId,
      defaultAddressId: input.addressId,
    };
  }

  if (!input.wasDefault) {
    return {
      isDefault: false,
      defaultAddressId: input.currentDefaultAddressId,
    };
  }

  const promoted = latest(input.activeOthers);
  if (!promoted) {
    return {
      isDefault: true,
      defaultAddressId: input.addressId,
    };
  }

  return {
    isDefault: false,
    promoteAddressId: promoted.addressId,
    defaultAddressId: promoted.addressId,
  };
}

export function planDeleteDefault(input: {
  wasDefault: boolean;
  activeOthers: DefaultAddressRef[];
  currentDefaultAddressId?: string;
}): DefaultAddressPlan {
  if (!input.wasDefault) {
    return {
      isDefault: false,
      defaultAddressId: input.currentDefaultAddressId,
    };
  }

  const promoted = latest(input.activeOthers);
  if (!promoted) {
    return {
      isDefault: false,
      defaultAddressId: null,
    };
  }

  return {
    isDefault: false,
    promoteAddressId: promoted.addressId,
    defaultAddressId: promoted.addressId,
  };
}
