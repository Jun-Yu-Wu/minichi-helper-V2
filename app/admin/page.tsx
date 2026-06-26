import { redirect } from "next/navigation";

import {
  activateTripAction,
  cancelTripAction,
  deactivateHelperAction,
  saveSitePhotoAction,
} from "../actions/admin";
import { SessionBar } from "../components/SessionBar";
import { ActionButtonForm } from "../components/ActionButtonForm";
import { Button } from "../components/ui/button";
import adminAuthorization from "../../src/server/admin-authorization";
import database from "../../src/server/database";
import service from "../../src/server/helper-app-service";
import { createR2ObjectStore } from "../../src/server/r2-object-store";
import { createServerSupabaseClient } from "../../src/server/supabase";
import { CreateHelperForm, CreateQuoteTaskForm, CreateTripForm, RepairTripForm } from "./AdminForms";

export default async function AdminPage() {
  const authClient = await createServerSupabaseClient();
  let admin;
  try {
    admin = await adminAuthorization.authorizeAdminByAllowlist(authClient);
  } catch {
    redirect("/login?next=/admin");
  }

  const dashboard = await service.listAdminDashboard(database.getDatabasePool());
  const sitePhotoBatches = dashboard.sitePhotoBatches.length
    ? await service.attachSignedPhotoUrls(
        dashboard.sitePhotoBatches,
        createR2ObjectStore(),
      )
    : [];
  const quoteTasks = dashboard.quoteTasks.length
    ? await service.attachSignedQuoteTaskUrls(
        dashboard.quoteTasks,
        createR2ObjectStore(),
      )
    : [];
  const sitePhotosByTripId = groupSitePhotosByTripId(sitePhotoBatches);

  return (
    <>
      <SessionBar email={admin.email} title="管理工作台" />
      <main className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-6">
        <section className="grid gap-4 lg:grid-cols-2">
          <CreateHelperForm />
          <CreateTripForm helpers={dashboard.helpers} />
        </section>

        <section className="grid gap-3">
          <h2 className="text-xl font-semibold">小幫手</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {dashboard.helpers.map((helper: any) => (
              <article key={helper.id} className="rounded-lg border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{helper.display_name}</h3>
                    <p className="text-sm text-muted-foreground">{helper.email}</p>
                    <p className="mt-1 text-sm">
                      {helper.is_active ? "啟用中" : "已停用"} · {helper.region || "未填地區"}
                    </p>
                  </div>
                  {helper.is_active ? (
                    <ActionButtonForm
                      action={deactivateHelperAction}
                      fields={[{ name: "helperId", value: helper.id }]}
                      label="停用"
                      variant="outline"
                    />
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="grid gap-3">
          <h2 className="text-xl font-semibold">行程狀態</h2>
          <div className="grid gap-3">
            {dashboard.trips.map((trip: any) => (
              <article key={trip.id} className="rounded-lg border bg-card p-4">
                <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                  <div>
                    <h3 className="font-semibold">{trip.trip_name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {service.dateOnly(trip.business_date, trip.timezone)} {trip.scheduled_time || ""} ·{" "}
                      {trip.timezone} · {trip.helper_display_name || "未指派"}
                    </p>
                    <p className="mt-2 text-sm">
                      狀態 <span className="font-medium">{trip.status}</span> · version{" "}
                      {trip.version}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-start gap-2">
                    {trip.status === "arrived" ? (
                      <ActionButtonForm
                        action={activateTripAction}
                        fields={[
                          { name: "tripId", value: trip.id },
                          { name: "expectedVersion", value: trip.version },
                        ]}
                        label="啟用"
                      />
                    ) : null}
                    {!["ended", "canceled"].includes(trip.status) ? (
                      <ActionButtonForm
                        action={cancelTripAction}
                        fields={[
                          { name: "tripId", value: trip.id },
                          { name: "expectedVersion", value: trip.version },
                          {
                            name: "reason",
                            value: "Admin canceled from first-slice UI",
                          },
                        ]}
                        label="取消"
                        variant="outline"
                      />
                    ) : null}
                  </div>
                </div>
                <RepairTripForm trip={trip} />
                <CreateQuoteTaskForm
                  availablePhotos={sitePhotosByTripId[trip.id] || []}
                  trip={trip}
                />
              </article>
            ))}
          </div>
        </section>

        <section className="grid gap-3">
          <h2 className="text-xl font-semibold">Live Return 現場照片</h2>
          {sitePhotoBatches.length === 0 ? (
            <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
              尚未收到現場照片批次。
            </p>
          ) : (
            <div className="grid gap-3">
              {sitePhotoBatches.map((batch: any) => (
                <article key={batch.id} className="rounded-lg border bg-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">{batch.trip_name}</h3>
                      <p className="text-sm text-muted-foreground">
                        {service.dateOnly(batch.business_date, batch.timezone)} ·{" "}
                        {batch.helper_display_name} · {batch.photos.length} 張
                      </p>
                      {batch.note ? <p className="mt-1 text-sm">{batch.note}</p> : null}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {new Date(batch.created_at).toLocaleString("zh-TW", {
                        timeZone: "Asia/Taipei",
                      })}
                    </p>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {batch.photos.map((photo: any) => (
                      <div key={photo.id} className="rounded-md border bg-background p-2">
                        <a href={photo.signed_url} target="_blank" rel="noreferrer">
                          <img
                            alt={photo.original_filename || "site photo"}
                            className="aspect-square w-full rounded-md object-cover"
                            src={photo.signed_url}
                          />
                        </a>
                        <div className="mt-2 grid gap-2">
                          <p className="truncate text-sm font-medium">
                            {photo.sort_order + 1}. {photo.original_filename || "現場照片"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {photo.saved_by_admin ? "已標記保存" : "temporary work media"}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {!photo.saved_by_admin ? (
                              <ActionButtonForm
                                action={saveSitePhotoAction}
                                fields={[{ name: "photoId", value: photo.id }]}
                                label="保存"
                                variant="outline"
                              />
                            ) : null}
                            <Button asChild size="sm" variant="secondary">
                              <a href={photo.signed_url} target="_blank" rel="noreferrer">
                                分享
                              </a>
                            </Button>
                            <Button asChild size="sm" variant="secondary">
                              <a href={photo.signed_url} download>
                                下載
                              </a>
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="grid gap-3">
          <h2 className="text-xl font-semibold">Live Return 詢價/細節回覆</h2>
          {quoteTasks.length === 0 ? (
            <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
              尚未發布詢價或細節任務。
            </p>
          ) : (
            <div className="grid gap-3">
              {quoteTasks.map((task: any) => (
                <article key={task.id} className="rounded-lg border bg-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">
                        {task.product_name || "未命名任務"} · {task.task_type}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {task.trip_name} · {task.helper_display_name} · 狀態 {task.status}
                      </p>
                      {task.instruction ? <p className="mt-1 text-sm">{task.instruction}</p> : null}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {new Date(task.created_at).toLocaleString("zh-TW", {
                        timeZone: "Asia/Taipei",
                      })}
                    </p>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {task.photos.map((photo: any) => (
                      <div key={photo.id} className="rounded-md border bg-background p-3">
                        <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
                          <a href={photo.signed_url} target="_blank" rel="noreferrer">
                            <img
                              alt={photo.product_name || "quote task photo"}
                              className="aspect-square w-full rounded-md object-cover"
                              src={photo.signed_url}
                            />
                          </a>
                          <div className="grid gap-2">
                            <p className="text-sm font-medium">
                              #{photo.sort_order + 1} · {photo.reply_status}
                              {photo.needs_review ? " · needs review" : ""}
                            </p>
                            {photo.latest_reply ? (
                              <div className="grid gap-2 text-sm">
                                {photo.latest_reply.price_jpy != null ? (
                                  <p>JPY {photo.latest_reply.price_jpy}</p>
                                ) : null}
                                {photo.latest_reply.note ? <p>{photo.latest_reply.note}</p> : null}
                                {photo.latest_reply.detail_photos?.length ? (
                                  <div className="grid grid-cols-3 gap-2">
                                    {photo.latest_reply.detail_photos.map((detailPhoto: any) => (
                                      <a
                                        key={detailPhoto.storage_key}
                                        href={detailPhoto.signed_url}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        <img
                                          alt={detailPhoto.original_filename || "detail photo"}
                                          className="aspect-square w-full rounded-md object-cover"
                                          src={detailPhoto.signed_url}
                                        />
                                      </a>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            ) : (
                              <p className="text-sm text-muted-foreground">等待小幫手回覆。</p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  );
}

function groupSitePhotosByTripId(batches: any[]) {
  const groups: Record<string, any[]> = {};
  for (const batch of batches) {
    if (!groups[batch.trip_id]) groups[batch.trip_id] = [];
    groups[batch.trip_id].push(...(batch.photos || []));
  }
  return groups;
}
