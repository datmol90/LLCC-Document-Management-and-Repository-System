# LLCC DMS Frontend ↔ Backend API Contract

Base URL: `/api` (Vite proxies to `http://localhost:5000`). Authentication: `Authorization: Bearer <JWT>` for every endpoint except login, forgot/reset and public verification.

## Auth
- `POST /auth/login` `{email,password}` → `{token,user:{id,name,email,role,departmentId,department}}`
- `GET /auth/me` → `{user}`
- `POST /auth/logout` → `{message}`
- `GET /auth/profile` → `{user:{id,name,email,role,department,departmentId,isActive,createdAt}}`
- `PUT /auth/profile` `{name,email,currentPassword?,newPassword?}` → `{user}`
- `POST /auth/forgot` `{email}` → `{message,resetToken?}` (token only in non-production)
- `POST /auth/reset` `{token,password}` → `{message}`

## Users / departments / catalog / settings / announcements
- `GET /users`, `POST /users`, `PUT /users/:id` (SUPER_ADMIN only). User shape: `{id,name,email,role,departmentId,department:{id,name,code},isActive,createdAt}`.
- `GET /departments?includeInactive=true`, `POST /departments`, `PUT /departments/:id` (mutations SUPER_ADMIN).
- `GET /categories` → `{categories:[{id,name,description,isActive}]}`; mutations SUPER_ADMIN.
- `GET /roles` → `{roles:[{id,name,level,description}]}`.
- `GET /settings` → `{settings:{expiryReminderDays:[...],backupEnabled:false,backupIntervalHours:24,maxFileSizeMB:20,aiEnabled:false,...}}`; `PUT /settings` (SUPER_ADMIN).
- `GET /announcements` → `{announcements:[{id,title,body,pinned,createdAt,createdBy:{name}}]}`; mutations SUPER_ADMIN/DEAN.

## Documents
- `GET /documents` query: `q,departmentId,category,categoryId,documentType,referenceNumber,keywords,status,approvalStatus,fileType,from,to,modifiedFrom,modifiedTo,sort,page,limit,view,expiring`
  → `{documents:[{id,title,description,category,categoryId,documentType,referenceNumber,keywords,status,departmentId,department:{id,name,code},uploader:{id,name},revisionCount,latestFileName,latestMimeType,latestFileSize,expiresAt,reviewDate,renewalStatus,createdAt,updatedAt,expired,expiringSoon,verificationCode,currentVersion:{id,versionNumber}}],total,page,limit,pages,view}`
- `GET /documents/:id` → `{document:{...above, versions:[{id,versionNumber,originalName,fileSize,changeNotes,createdAt,createdBy:{name}}], approvals:[{id,status,comments,createdAt,reviewedAt,submittedBy:{name},reviewedBy:{name}}], uploader, department}}`
- `POST /documents` multipart fields: `file,title,description,category,categoryId,departmentId,documentType,referenceNumber,keywords,expiresAt,reviewDate,status(DRAFT|PENDING),requiresFinalApproval`
- `PUT /documents/:id` multipart or JSON: same metadata fields + optional `file`, `changeNotes`, `status(DRAFT|ARCHIVED)`
- `DELETE /documents/:id` (soft delete, body/query optional `reason`)
- `POST /documents/:id/restore`, `DELETE /documents/:id/purge?confirm=true`
- `POST /documents/:id/archive`, `POST /documents/:id/unarchive`
- `GET /documents/:id/download?versionId=` (blob, authenticated)
- `GET /documents/:id/preview?versionId=` → either PDF/image blob OR `{kind:'office'|'text'|'unsupported',html?,message?,downloadUrl?}`
- `GET /documents/:id/qr` → `{code,url,qr:dataUrl}` (approved only)
- `GET /documents/:id/verification` → `{code,approved,url?}`
- `POST /documents/:id/versions/:versionId/restore` → `{document}`
- `POST /documents/:id/submit` → `{approval,document}`
- `POST /documents/:id/approval` `{action:'APPROVED'|'REJECTED'|'REVISION_REQUESTED'|'APPROVE_STAGE1',comments}` → `{approval,status,verificationCode?}`
- `GET /documents/approvals/pending` → `{documents:[...]}`
- `GET /documents/expiring` → `{expiring:[...],expired:[...]}` with `daysLeft`
- `POST /documents/run-expiration-scan` (SUPER_ADMIN)

## Notifications / audits / dashboard
- `GET /notifications` → `{notifications:[{id,type,title,message,isRead,createdAt,actor:{name},document:{id,title}}],unreadCount}`
- `POST /notifications/:id/read`, `POST /notifications/read-all`
- `GET /audit-logs?page&limit&action&entityType&from&to&userId` → `{logs,total,page,limit,pages}`
- `GET /dashboard` → `{stats:{totalDocuments,totalDepartments,totalUsers,pendingApprovals,approved,rejected,archived,draft},recentUploads,recentUpdates,recentActivity,departmentStats}`

## Reports / AI / backups / verification
- `GET /reports/analytics?from&to&departmentId` → `{analytics:{generatedAt,scopeLabel,totals,byStatus,byDepartment,byCategory,byUploader,monthlyUploads,recentUploads,recentUpdates,expiringSoon,expired,pendingDocuments,approvalRate,filtersApplied}}`
- `GET /reports/export/pdf?from&to&departmentId` (blob), `GET /reports/export/excel?...` (blob)
- `POST /assistant/ask` `{question}` → `{answer,intent,results,total,elapsedMs,scope,source}`
- `GET /backups`, `POST /backups` `{kind:'FULL'|'DB_ONLY'}`, `GET /backups/:id/download`, `DELETE /backups/:id`, `POST /backups/:id/restore` `{confirm:'RESTORE'}`
- `GET /verify/:code` PUBLIC → `{valid,result,message,verifiedAt?,document:{title,category,department,status,revisionCount,approvedAt,approvedBy,updatedOn,file,verificationCode,validity}}`
- `GET /verification-logs` (SUPER_ADMIN/DEAN)

## Role codes
`SUPER_ADMIN`, `DEAN`, `DEPARTMENT_HEAD`, `STAFF`.

## Status codes
`APPROVED`, `PENDING`, `FINAL_REVIEW`, `DRAFT`, `REJECTED`, `REVISION_REQUESTED`, `ARCHIVED`.
