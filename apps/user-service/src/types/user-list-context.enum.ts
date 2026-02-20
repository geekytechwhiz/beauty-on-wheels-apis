export enum UserListContext {
  ADMIN_DASHBOARD = 'ADMIN_DASHBOARD',
  CHAT_STAFF_LIST = 'CHAT_STAFF_LIST',
  PATIENT_CARE_TEAM = 'PATIENT_CARE_TEAM',
  DOCTOR_PATIENT_LIST = 'DOCTOR_PATIENT_LIST',
  PAST_CONSULTATIONS = 'PAST_CONSULTATIONS',
  ACTIVE_CONSULTATIONS = 'ACTIVE_CONSULTATIONS',
  DOCTOR_SELECTION = 'DOCTOR_SELECTION',
  PATIENT_CHAT_LIST = 'PATIENT_CHAT_LIST',
}

export const UserListContextValues = Object.values(UserListContext);

export interface V2UserListFilters {
  userTypes?: string[];
  roleCodes?: string[];
  isActive?: boolean;
  isRpmUser?: boolean;
  doctorId?: string;
  patientId?: string;
  search?: string;
  status?: string;
}

export interface V2UserListPagination {
  limit?: number;
  cursor?: string | null;
}

export interface V2UserListSort {
  field?: string;
  order?: 'ASC' | 'DESC';
}

export interface V2UserListRequest {
  organizationId: string;
  context: UserListContext;
  filters?: V2UserListFilters;
  pagination?: V2UserListPagination;
  sort?: V2UserListSort;
}

export interface V2UserListMeta {
  requestId: string;
  timestamp: number;
  version: string;
  nextCursor?: string | null;
}

export interface V2UserListResponse<T = unknown> {
  success: boolean;
  statusCode: number;
  message: {
    title: string;
    description: string;
    severity: 'SUCCESS' | 'ERROR' | 'WARNING' | 'INFO';
  };
  data: {
    items: T[];
  };
  error: null | { code: string; details: Array<{ message: string }> };
  meta: V2UserListMeta;
}
