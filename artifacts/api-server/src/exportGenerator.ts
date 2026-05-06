import PDFDocument from "pdfkit";
import archiver from "archiver";
import { db } from "./db";
import { exports as exportsTable, taskCompletions, tasks, attachments, taskLinks, assets, assetProperties, users, communities } from "@workspace/db";
import { eq, and, gte, lte, desc, sql, inArray } from "drizzle-orm";
import { objectStorageClient } from "./objectStorage";
import { Writable } from "stream";

interface ExportFilters {
  dateFrom: string;
  dateTo: string;
  communityId: string;
  assetType?: string;
  contractorId?: string;
  status?: string;
  includePhotosZip?: boolean;
}

interface CompletionRow {
  completionId: string;
  completedAt: Date;
  completedByName: string;
  employeeSignOffName: string;
  notes: string | null;
  timeSpentMinutes: number | null;
  materialsUsed: string | null;
  followUpNeeded: string | null;
  taskTitle: string;
  taskStatus: string;
  taskPriority: string;
  taskDueDate: Date | null;
  assetId: string | null;
  assetType: string | null;
  assetLabel: string | null;
  assetFeatureRef: string | null;
  assetLat: number | null;
  assetLng: number | null;
  attachmentIds: string[];
  attachmentUrls: string[];
  attachmentFileRefs: string[];
}

function getPrivateDir(): string {
  const dir = process.env.PRIVATE_OBJECT_DIR || "";
  if (!dir) throw new Error("PRIVATE_OBJECT_DIR not set");
  return dir;
}

function parseObjectPath(path: string): { bucketName: string; objectName: string } {
  if (!path.startsWith("/")) path = `/${path}`;
  const parts = path.split("/");
  if (parts.length < 3) throw new Error("Invalid path");
  return { bucketName: parts[1], objectName: parts.slice(2).join("/") };
}

async function uploadBuffer(buffer: Buffer, fileName: string, contentType: string): Promise<string> {
  const privateDir = getPrivateDir();
  const fullPath = `${privateDir}/exports/${fileName}`;
  const { bucketName, objectName } = parseObjectPath(fullPath);
  const bucket = objectStorageClient.bucket(bucketName);
  const file = bucket.file(objectName);
  await file.save(buffer, { contentType, resumable: false });
  return `/objects/exports/${fileName}`;
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

async function downloadAttachmentBuffer(fileRef: string): Promise<Buffer | null> {
  try {
    const privateDir = getPrivateDir();
    let objectEntityDir = privateDir;
    if (!objectEntityDir.endsWith("/")) objectEntityDir += "/";

    let fullPath: string;
    if (fileRef.startsWith("/objects/")) {
      const entityId = fileRef.slice("/objects/".length);
      fullPath = `${objectEntityDir}${entityId}`;
    } else {
      fullPath = fileRef;
    }

    const { bucketName, objectName } = parseObjectPath(fullPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [contents] = await file.download();
    return contents;
  } catch (err) {
    console.error("Failed to download attachment:", fileRef, err);
    return null;
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-. ]/g, "_").substring(0, 80);
}

async function queryCompletions(filters: ExportFilters): Promise<CompletionRow[]> {
  const dateFrom = new Date(filters.dateFrom);
  const dateTo = new Date(filters.dateTo);
  dateTo.setHours(23, 59, 59, 999);

  const conditions = [
    eq(tasks.communityId, filters.communityId),
    gte(taskCompletions.completedAt, dateFrom),
    lte(taskCompletions.completedAt, dateTo),
  ];

  if (filters.contractorId) {
    conditions.push(eq(taskCompletions.completedBy, filters.contractorId));
  }
  if (filters.status && filters.status !== "all") {
    conditions.push(eq(tasks.status, filters.status as any));
  }

  const rows = await db
    .select({
      completionId: taskCompletions.id,
      completedAt: taskCompletions.completedAt,
      completedByName: users.displayName,
      employeeSignOffName: taskCompletions.employeeSignOffName,
      notes: taskCompletions.notes,
      timeSpentMinutes: taskCompletions.timeSpentMinutes,
      materialsUsed: taskCompletions.materialsUsed,
      followUpNeeded: taskCompletions.followUpNeeded,
      taskId: tasks.id,
      taskTitle: tasks.title,
      taskStatus: tasks.status,
      taskPriority: tasks.priority,
      taskDueDate: tasks.dueDate,
    })
    .from(taskCompletions)
    .innerJoin(tasks, eq(taskCompletions.taskId, tasks.id))
    .innerJoin(users, eq(taskCompletions.completedBy, users.id))
    .where(and(...conditions))
    .orderBy(taskCompletions.completedAt);

  const completionIds = rows.map((r) => r.completionId);
  if (completionIds.length === 0) return [];

  const taskIds = [...new Set(rows.map((r) => r.taskId))];

  const allAttachments = completionIds.length > 0
    ? await db
        .select({
          taskCompletionId: attachments.taskCompletionId,
          id: attachments.id,
          url: attachments.url,
          fileRef: attachments.fileRef,
        })
        .from(attachments)
        .where(inArray(attachments.taskCompletionId, completionIds))
    : [];

  const attachmentMap = new Map<string, typeof allAttachments>();
  for (const att of allAttachments) {
    const list = attachmentMap.get(att.taskCompletionId) || [];
    list.push(att);
    attachmentMap.set(att.taskCompletionId, list);
  }

  const allLinks = taskIds.length > 0
    ? await db
        .select({
          taskId: taskLinks.taskId,
          assetId: taskLinks.assetId,
        })
        .from(taskLinks)
        .where(and(inArray(taskLinks.taskId, taskIds), eq(taskLinks.linkType, "asset")))
    : [];

  const taskAssetMap = new Map<string, string>();
  for (const link of allLinks) {
    if (link.assetId) taskAssetMap.set(link.taskId, link.assetId);
  }

  const assetIds = [...new Set(allLinks.filter((l) => l.assetId).map((l) => l.assetId!))];
  const allAssets = assetIds.length > 0
    ? await db
        .select({
          id: assets.id,
          assetType: assets.assetType,
          label: assets.label,
          featureRef: assets.featureRef,
          latitude: assets.latitude,
          longitude: assets.longitude,
        })
        .from(assets)
        .where(inArray(assets.id, assetIds))
    : [];

  const assetMap = new Map<string, (typeof allAssets)[0]>();
  for (const a of allAssets) {
    assetMap.set(a.id, a);
  }

  const results: CompletionRow[] = rows.map((row) => {
    const assetId = taskAssetMap.get(row.taskId) || null;
    const asset = assetId ? assetMap.get(assetId) : null;
    const atts = attachmentMap.get(row.completionId) || [];

    return {
      completionId: row.completionId,
      completedAt: row.completedAt,
      completedByName: row.completedByName,
      employeeSignOffName: row.employeeSignOffName,
      notes: row.notes,
      timeSpentMinutes: row.timeSpentMinutes,
      materialsUsed: row.materialsUsed,
      followUpNeeded: row.followUpNeeded,
      taskTitle: row.taskTitle,
      taskStatus: row.taskStatus,
      taskPriority: row.taskPriority,
      taskDueDate: row.taskDueDate,
      assetId: assetId,
      assetType: asset?.assetType || null,
      assetLabel: asset?.label || null,
      assetFeatureRef: asset?.featureRef || null,
      assetLat: asset?.latitude || null,
      assetLng: asset?.longitude || null,
      attachmentIds: atts.map((a) => a.id),
      attachmentUrls: atts.map((a) => a.url),
      attachmentFileRefs: atts.map((a) => a.fileRef),
    };
  });

  if (filters.assetType) {
    return results.filter((r) => r.assetType === filters.assetType);
  }

  return results;
}

function groupCompletions(completions: CompletionRow[]): Map<string, Map<string, CompletionRow[]>> {
  const grouped = new Map<string, Map<string, CompletionRow[]>>();
  for (const c of completions) {
    const type = c.assetType || "Unlinked";
    const label = c.assetLabel || "No Asset";
    if (!grouped.has(type)) grouped.set(type, new Map());
    const typeMap = grouped.get(type)!;
    if (!typeMap.has(label)) typeMap.set(label, []);
    typeMap.get(label)!.push(c);
  }
  return grouped;
}

function formatDate(d: Date | null | undefined): string {
  if (!d) return "N/A";
  return new Date(d).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
}

async function generatePDF(
  communityName: string,
  filters: ExportFilters,
  completions: CompletionRow[]
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
      bufferPages: true,
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const NAVY = "#0C1D31";
    const TEAL = "#25C1AC";
    const GRAY = "#6B7280";
    const LIGHT_GRAY = "#F3F4F6";
    const pageWidth = 612 - 100;

    doc.rect(0, 0, 612, 120).fill(NAVY);
    doc.fillColor("#ffffff").fontSize(28).font("Helvetica-Bold");
    doc.text("Proof of Work Report", 50, 40);
    doc.fontSize(12).font("Helvetica").fillColor(TEAL);
    doc.text("VRTSync Field Operations", 50, 75);

    doc.fillColor(NAVY).fontSize(16).font("Helvetica-Bold");
    doc.text(communityName, 50, 145);

    doc.fillColor(GRAY).fontSize(10).font("Helvetica");
    doc.text(`Date Range: ${filters.dateFrom} to ${filters.dateTo}`, 50, 170);
    doc.text(`Generated: ${new Date().toLocaleString("en-US", { timeZone: "America/Denver" })}`, 50, 185);

    const contractorCounts: Record<string, number> = {};
    const assetTypeCounts: Record<string, number> = {};
    let followUpCount = 0;

    for (const c of completions) {
      contractorCounts[c.completedByName] = (contractorCounts[c.completedByName] || 0) + 1;
      const at = c.assetType || "Unlinked";
      assetTypeCounts[at] = (assetTypeCounts[at] || 0) + 1;
      if (c.followUpNeeded && c.followUpNeeded.toLowerCase() !== "no" && c.followUpNeeded.trim() !== "") {
        followUpCount++;
      }
    }

    doc.moveDown(2);
    let yPos = doc.y;

    doc.rect(50, yPos, pageWidth, 25).fill(TEAL);
    doc.fillColor("#ffffff").fontSize(12).font("Helvetica-Bold");
    doc.text("Summary", 60, yPos + 7);
    yPos += 35;

    doc.fillColor(NAVY).fontSize(11).font("Helvetica-Bold");
    doc.text(`Total Completions: ${completions.length}`, 60, yPos);
    yPos += 18;
    doc.text(`Follow-ups Needed: ${followUpCount}`, 60, yPos);
    yPos += 25;

    doc.fillColor(NAVY).fontSize(10).font("Helvetica-Bold");
    doc.text("By Contractor:", 60, yPos);
    yPos += 15;
    doc.font("Helvetica").fillColor(GRAY);
    for (const [name, count] of Object.entries(contractorCounts).sort((a, b) => b[1] - a[1])) {
      doc.text(`  ${name}: ${count} completion${count > 1 ? "s" : ""}`, 60, yPos);
      yPos += 14;
    }
    yPos += 10;

    doc.fillColor(NAVY).fontSize(10).font("Helvetica-Bold");
    doc.text("By Asset Type:", 60, yPos);
    yPos += 15;
    doc.font("Helvetica").fillColor(GRAY);
    for (const [type, count] of Object.entries(assetTypeCounts).sort((a, b) => b[1] - a[1])) {
      doc.text(`  ${capitalize(type)}: ${count}`, 60, yPos);
      yPos += 14;
    }

    const grouped = groupCompletions(completions);

    for (const [assetType, assetMap] of grouped) {
      doc.addPage();
      yPos = 50;

      doc.rect(50, yPos, pageWidth, 28).fill(NAVY);
      doc.fillColor("#ffffff").fontSize(14).font("Helvetica-Bold");
      doc.text(capitalize(assetType), 60, yPos + 8);
      yPos += 40;

      for (const [assetLabel, comps] of assetMap) {
        if (yPos > 680) {
          doc.addPage();
          yPos = 50;
        }

        doc.rect(50, yPos, pageWidth, 22).fill(LIGHT_GRAY);
        doc.fillColor(NAVY).fontSize(11).font("Helvetica-Bold");
        doc.text(assetLabel, 60, yPos + 5);

        if (comps[0]?.assetFeatureRef) {
          const refText = `Ref: ${comps[0].assetFeatureRef}`;
          doc.fillColor(GRAY).fontSize(8).font("Helvetica");
          doc.text(refText, 350, yPos + 7);
        }

        yPos += 28;

        for (const comp of comps) {
          if (yPos > 680) {
            doc.addPage();
            yPos = 50;
          }

          doc.rect(55, yPos, pageWidth - 10, 1).fill("#E5E7EB");
          yPos += 6;

          doc.fillColor(NAVY).fontSize(10).font("Helvetica-Bold");
          doc.text(comp.taskTitle, 60, yPos, { width: pageWidth - 20 });
          yPos += 14;

          doc.fillColor(GRAY).fontSize(9).font("Helvetica");
          doc.text(`Completed: ${formatDate(comp.completedAt)}  |  By: ${comp.completedByName}`, 60, yPos);
          yPos += 12;

          if (comp.employeeSignOffName) {
            doc.text(`Sign-off: ${comp.employeeSignOffName}`, 60, yPos);
            yPos += 12;
          }

          const details: string[] = [];
          if (comp.timeSpentMinutes) details.push(`Time: ${comp.timeSpentMinutes} min`);
          if (comp.taskPriority) details.push(`Priority: ${capitalize(comp.taskPriority)}`);
          if (comp.taskDueDate) details.push(`Due: ${formatDate(comp.taskDueDate)}`);
          if (details.length > 0) {
            doc.text(details.join("  |  "), 60, yPos);
            yPos += 12;
          }

          if (comp.notes) {
            doc.fillColor(NAVY).fontSize(9).font("Helvetica");
            doc.text(`Notes: ${comp.notes}`, 60, yPos, { width: pageWidth - 20 });
            yPos = doc.y + 4;
          }

          if (comp.materialsUsed) {
            doc.fillColor(GRAY).fontSize(9);
            doc.text(`Materials: ${comp.materialsUsed}`, 60, yPos, { width: pageWidth - 20 });
            yPos = doc.y + 4;
          }

          if (comp.followUpNeeded && comp.followUpNeeded.toLowerCase() !== "no" && comp.followUpNeeded.trim() !== "") {
            doc.fillColor("#DC2626").fontSize(9).font("Helvetica-Bold");
            doc.text(`⚠ Follow-up: ${comp.followUpNeeded}`, 60, yPos, { width: pageWidth - 20 });
            yPos = doc.y + 4;
          }

          const photoCount = comp.attachmentIds.length;
          if (photoCount > 0) {
            doc.fillColor(TEAL).fontSize(8).font("Helvetica");
            doc.text(`📎 ${photoCount} photo${photoCount > 1 ? "s" : ""} attached`, 60, yPos);
            yPos += 12;
          }

          yPos += 8;
        }

        yPos += 6;
      }
    }

    if (completions.length === 0) {
      doc.addPage();
      doc.fillColor(GRAY).fontSize(14).font("Helvetica");
      doc.text("No completions found for the selected date range and filters.", 50, 100, {
        align: "center",
        width: pageWidth,
      });
    }

    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fillColor(GRAY).fontSize(8).font("Helvetica");
      doc.text(`Page ${i + 1} of ${pageCount}`, 50, 740, {
        align: "center",
        width: pageWidth,
      });
    }

    doc.end();
  });
}

async function generatePhotosZip(completions: CompletionRow[]): Promise<Buffer | null> {
  const completionsWithPhotos = completions.filter((c) => c.attachmentFileRefs.length > 0);
  if (completionsWithPhotos.length === 0) return null;

  return new Promise(async (resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 5 } });
    const chunks: Buffer[] = [];

    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);

    for (const comp of completionsWithPhotos) {
      const assetType = sanitizeFilename(comp.assetType || "unlinked");
      const assetLabel = sanitizeFilename(comp.assetLabel || "no-asset");
      const taskTitle = sanitizeFilename(comp.taskTitle);

      for (let i = 0; i < comp.attachmentFileRefs.length; i++) {
        const fileRef = comp.attachmentFileRefs[i];
        const buf = await downloadAttachmentBuffer(fileRef);
        if (buf) {
          const ext = fileRef.includes(".") ? fileRef.substring(fileRef.lastIndexOf(".")) : ".jpg";
          const filename = `photo_${i + 1}${ext}`;
          archive.append(buf, { name: `${assetType}/${assetLabel}/${taskTitle}/${filename}` });
        }
      }
    }

    archive.finalize();
  });
}

export async function runExportGeneration(exportId: string): Promise<void> {
  try {
    await db
      .update(exportsTable)
      .set({ status: "running" })
      .where(eq(exportsTable.id, exportId));

    const [exportRow] = await db
      .select()
      .from(exportsTable)
      .where(eq(exportsTable.id, exportId));

    if (!exportRow) throw new Error("Export not found");

    const filters = exportRow.filters as ExportFilters;

    const [community] = await db
      .select({ name: communities.name })
      .from(communities)
      .where(eq(communities.id, filters.communityId));

    const communityName = community?.name || "Unknown Community";

    const completions = await queryCompletions(filters);

    const pdfBuffer = await generatePDF(communityName, filters, completions);
    const timestamp = Date.now();
    const pdfRef = await uploadBuffer(
      pdfBuffer,
      `pow_${exportId}_${timestamp}.pdf`,
      "application/pdf"
    );

    let zipRef: string | null = null;
    if (filters.includePhotosZip) {
      const zipBuffer = await generatePhotosZip(completions);
      if (zipBuffer) {
        zipRef = await uploadBuffer(
          zipBuffer,
          `pow_photos_${exportId}_${timestamp}.zip`,
          "application/zip"
        );
      }
    }

    await db
      .update(exportsTable)
      .set({
        status: "complete",
        pdfFileRef: pdfRef,
        photosZipRef: zipRef,
        completedAt: new Date(),
      })
      .where(eq(exportsTable.id, exportId));
  } catch (err: any) {
    console.error("Export generation failed:", err);
    await db
      .update(exportsTable)
      .set({
        status: "failed",
        errorMessage: err.message || "Unknown error",
        completedAt: new Date(),
      })
      .where(eq(exportsTable.id, exportId));
  }
}
