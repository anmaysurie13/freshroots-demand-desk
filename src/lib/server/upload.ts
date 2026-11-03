import { rulesConfig } from "../config";
import { FILE_KEYS, FILE_LABELS, type FileKey } from "../validation/validate";
import { HttpError } from "./auth";
import { sampleFiles, withPreviousMasters, type UploadedFiles } from "./runs";

export interface UploadForm {
  files: UploadedFiles;
  isSample: boolean;
  ackWarnings: boolean;
}

/** Reads the multipart form: up to five CSV files, the "use previous masters" and "sample data" switches. */
export async function readUploadForm(req: Request): Promise<UploadForm> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, "The upload could not be read.");
  }
  const isSample = form.get("sample") === "true";
  const usePrevious = form.get("usePrevious") === "true";
  const ackWarnings = form.get("ackWarnings") === "true";

  let files: UploadedFiles = {};
  if (isSample) {
    files = sampleFiles();
  } else {
    for (const key of FILE_KEYS) {
      const f = form.get(key);
      if (f instanceof File && f.size > 0) {
        if (!f.name.toLowerCase().endsWith(".csv")) throw new HttpError(400, `${FILE_LABELS[key as FileKey]}: only .csv files are accepted.`);
        if (f.size > rulesConfig.data.maxFileBytes) {
          throw new HttpError(400, `${f.name} is larger than ${Math.round(rulesConfig.data.maxFileBytes / 1024)} KB.`);
        }
        files[key] = await f.text();
      }
    }
    files = await withPreviousMasters(files, usePrevious);
  }
  return { files, isSample, ackWarnings };
}
