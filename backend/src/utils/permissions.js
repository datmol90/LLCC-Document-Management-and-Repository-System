export const Roles = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  DEAN: 'DEAN',
  DEPARTMENT_HEAD: 'DEPARTMENT_HEAD',
  STAFF: 'STAFF',
};

export function canManageUsers(user) { return user.role === Roles.SUPER_ADMIN; }
export function canManageDepartments(user) { return user.role === Roles.SUPER_ADMIN; }
export function canApprove(user) { return [Roles.SUPER_ADMIN, Roles.DEAN, Roles.DEPARTMENT_HEAD].includes(user.role); }

export function canAccessDepartment(user, departmentId) {
  if ([Roles.SUPER_ADMIN, Roles.DEAN].includes(user.role)) return true;
  return user.departmentId === departmentId;
}

export function canViewDocument(user, doc) {
  if (doc.deletedAt) {
    // Only users who may delete can inspect recycle-bin entries.
    if (!canDeleteDocument(user, doc)) return false;
  }
  if ([Roles.SUPER_ADMIN, Roles.DEAN].includes(user.role)) return true;
  if (user.role === Roles.DEPARTMENT_HEAD) return doc.departmentId === user.departmentId;
  if (user.role === Roles.STAFF) {
    return doc.departmentId === user.departmentId && (doc.status === 'APPROVED' || doc.uploaderId === user.id);
  }
  return false;
}

export function canModifyDocument(user, doc) {
  if (doc.deletedAt) return false; // no edits while in recycle bin
  if (user.role === Roles.SUPER_ADMIN) return true;
  if ([Roles.DEAN, Roles.DEPARTMENT_HEAD].includes(user.role)) return doc.departmentId === user.departmentId;
  if (user.role === Roles.STAFF) return doc.uploaderId === user.id;
  return false;
}

export function canDeleteDocument(user, doc) {
  if (user.role === Roles.SUPER_ADMIN) return true;
  if (user.role === Roles.DEPARTMENT_HEAD) return doc.departmentId === user.departmentId;
  return false;
}

export function canRestoreDocument(user, doc) { return canDeleteDocument(user, doc); }

export function canExportReports(user) {
  return [Roles.SUPER_ADMIN, Roles.DEAN, Roles.DEPARTMENT_HEAD].includes(user.role);
}

export function canManageBackups(user) { return user.role === Roles.SUPER_ADMIN; }

/**
 * Returns a Prisma `where` fragment limiting documents to what `user` may see.
 * Excludes recycle-bin entries unless `includeDeleted` is true.
 */
export function documentScopeWhere(user, { includeDeleted = false } = {}) {
  const where = {};
  if (!includeDeleted) where.deletedAt = null;

  if (user.role === Roles.STAFF) {
    where.departmentId = user.departmentId || '__none__';
    where.OR = [{ status: 'APPROVED' }, { uploaderId: user.id }];
  } else if (user.role === Roles.DEPARTMENT_HEAD) {
    where.departmentId = user.departmentId || '__none__';
  }
  return where;
}
