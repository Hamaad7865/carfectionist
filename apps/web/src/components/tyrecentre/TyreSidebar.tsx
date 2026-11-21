"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronRight, ChevronsUpDown, LogOut, Settings2 } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Kbd } from "@/components/ui/kbd";
import { signOut } from "@/lib/auth/actions";
import { ROLE_LABEL, type Role } from "@/lib/auth/roles";
import { isActiveHref, type BadgeKind, type TcNav, type TcNavLink } from "@/lib/tyrecentre/nav";
import { entityColours } from "@/lib/tyrecentre/entity-colours";
import type { ShellStatus } from "@/features/tyrecentre/shell-actions";
import { TyreMark } from "./TyreMark";

export function initials(name: string): string {
  const clean = name.replace(/\s*\(.*\)\s*$/, "").trim();
  const parts = clean.split(/\s+/);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : clean.slice(0, 2)).toUpperCase();
}

const ROW = "h-8 gap-2 rounded-[6px] px-2 text-[14px] font-medium text-tc-body [&>svg]:size-4";
const ACTIVE = "data-[active=true]:bg-tc-sidebar-active data-[active=true]:font-semibold data-[active=true]:text-tc-ink";
const LABEL = "h-7 px-2 text-[12px] font-semibold text-tc-faint";

function badgeFor(kind: BadgeKind | undefined, status: ShellStatus | null) {
  if (!kind || !status) return null;
  if (kind === "readyJobs") {
    return status.readyJobs > 0 ? (
      <SidebarMenuBadge className="h-[18px] min-w-[18px] rounded-[5px] bg-tc-highlight px-1 text-[11px] font-bold text-tc-on-highlight">
        {status.readyJobs}
      </SidebarMenuBadge>
    ) : null;
  }
  if (kind === "lowStock") {
    return status.lowStock > 0 ? (
      <SidebarMenuBadge className="h-[18px] rounded-[5px] bg-tc-danger-soft px-1.5 text-[11px] font-semibold text-tc-danger-ink">
        {status.lowStock} low
      </SidebarMenuBadge>
    ) : null;
  }
  return null;
}

function NavRow({ link, pathname, status }: { link: TcNavLink; pathname: string; status: ShellStatus | null }) {
  const Icon = link.icon;
  if (link.children) {
    const open = isActiveHref(pathname, link.href);
    return (
      <Collapsible asChild defaultOpen className="group/collapsible">
        <SidebarMenuItem>
          <CollapsibleTrigger asChild>
            <SidebarMenuButton tooltip={link.label} isActive={open} className={`${ROW} ${ACTIVE}`}>
              <Icon />
              <span>{link.label}</span>
              <ChevronDown className="ml-auto !size-4 text-tc-faint transition-transform group-data-[state=closed]/collapsible:-rotate-90" />
            </SidebarMenuButton>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <SidebarMenuSub className="mx-3.5 border-tc-sidebar-border px-2">
              {link.children.map((c) => (
                <SidebarMenuSubItem key={c.key}>
                  <SidebarMenuSubButton asChild className="h-7 text-[13.5px] text-tc-muted hover:text-tc-ink">
                    <Link href={c.href}>
                      <span>{c.label}</span>
                      {c.badge === "unpaidInvoices" && (status?.unpaidInvoices ?? 0) > 0 && (
                        <span className="ml-auto text-[12px] font-medium text-tc-danger">{status!.unpaidInvoices} unpaid</span>
                      )}
                    </Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              ))}
            </SidebarMenuSub>
          </CollapsibleContent>
        </SidebarMenuItem>
      </Collapsible>
    );
  }
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild tooltip={link.label} isActive={isActiveHref(pathname, link.href)} className={`${ROW} ${ACTIVE}`}>
        <Link href={link.href}>
          <Icon />
          <span>{link.label}</span>
          {link.chevron && <ChevronRight className="ml-auto !size-4 text-tc-faint" />}
        </Link>
      </SidebarMenuButton>
      {link.kbd && (
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 group-data-[collapsible=icon]:hidden">
          <Kbd variant="flat" size="sm" className="bg-transparent font-mono text-[10.5px] text-tc-faint">
            {link.kbd}
          </Kbd>
        </span>
      )}
      {badgeFor(link.badge, status)}
    </SidebarMenuItem>
  );
}

/** The tyre-centre sidebar — shadcn `sidebar`, DESIGN-SPEC §6.1. */
export function TyreSidebar({
  nav,
  status,
  brandName,
  displayName,
  role,
}: {
  nav: TcNav;
  status: ShellStatus | null;
  brandName: string;
  displayName: string;
  role: Role;
}) {
  const pathname = usePathname();
  const name = displayName.replace(/\s*\(.*\)\s*$/, "").trim();
  const companies = status?.companies ?? [];
  const companyName = companies[0]?.name ?? brandName;

  return (
    <Sidebar collapsible="icon" data-tour="sidebar" className="border-r border-tc-sidebar-border [&_[data-slot=sidebar-inner]]:bg-tc-sidebar">
      <SidebarHeader className="p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" className="h-12 gap-2.5 px-2 data-[state=open]:bg-tc-sidebar-active group-data-[collapsible=icon]:!p-0">
                  <TyreMark size={32} radius={8} />
                  <div className="grid flex-1 text-left leading-tight">
                    <span className="truncate text-[14px] font-bold text-tc-ink">{companyName}</span>
                    {status?.shopName && <span className="truncate text-[12px] text-tc-muted">{status.shopName}</span>}
                  </div>
                  <ChevronsUpDown className="ml-auto !size-4 text-tc-faint" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="bottom" className="w-60 rounded-[10px]">
                <DropdownMenuLabel className="text-[12px] text-tc-faint">Companies</DropdownMenuLabel>
                {companies.map((c, i) => (
                  <DropdownMenuItem key={c.name} className="gap-2">
                    <span className="size-3.5 rounded-[4px]" style={{ background: entityColours(i).accent }} />
                    <span className="flex-1 truncate">{c.name}</span>
                  </DropdownMenuItem>
                ))}
                {nav.settings && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild className="gap-2">
                      <Link href="/settings">
                        <Settings2 className="size-4" /> Business settings
                      </Link>
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="gap-0">
        <SidebarGroup className="p-2">
          <SidebarGroupLabel className={LABEL}>Shop floor</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {nav.shopFloor.map((l) => (
                <NavRow key={l.key} link={l} pathname={pathname} status={status} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {companies.length > 0 && (
          <>
            <SidebarSeparator className="mx-3 hidden bg-tc-sidebar-border group-data-[collapsible=icon]:block" />
            <SidebarGroup className="p-2">
              <SidebarGroupLabel className={LABEL}>Companies</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="gap-0.5">
                  {companies.map((c, i) => {
                    const col = entityColours(i);
                    const body = (
                      <>
                        <span className="!size-4 shrink-0 rounded-[4px]" style={{ background: col.accent }} />
                        <span className="truncate">{c.name}</span>
                        <span className="ml-auto font-mono text-[10.5px] font-semibold tracking-[0.06em]" style={{ color: col.ink }}>
                          {c.vatRegistered ? "VAT" : "NO VAT"}
                        </span>
                      </>
                    );
                    return (
                      <SidebarMenuItem key={c.name}>
                        {nav.settings ? (
                          <SidebarMenuButton asChild tooltip={c.name} className={ROW}>
                            <Link href="/settings">{body}</Link>
                          </SidebarMenuButton>
                        ) : (
                          <SidebarMenuButton tooltip={c.name} className={`${ROW} cursor-default hover:bg-transparent`}>
                            {body}
                          </SidebarMenuButton>
                        )}
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}

        {nav.till.length > 0 && (
          <SidebarGroup className="p-2">
            <SidebarGroupLabel className={LABEL}>Till</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {nav.till.map((l) => {
                  const Icon = l.icon;
                  return (
                    <SidebarMenuItem key={l.key}>
                      <SidebarMenuButton asChild tooltip={l.label} className={ROW}>
                        <Link href={l.href}>
                          <Icon />
                          <span>{l.label}</span>
                          {l.key === "drawer" && status && (
                            <span className={`ml-auto text-[12.5px] font-medium ${status.tillOpen ? "text-tc-success" : "text-tc-faint"}`}>
                              {status.tillOpen ? "● Open" : "Closed"}
                            </span>
                          )}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {nav.more.length > 0 && (
          <SidebarGroup className="p-2">
            <Collapsible className="group/more" defaultOpen={nav.more.some((l) => isActiveHref(pathname, l.href))}>
              <SidebarGroupLabel asChild className={LABEL}>
                <CollapsibleTrigger className="w-full">
                  More
                  <ChevronDown className="ml-auto !size-3.5 transition-transform group-data-[state=closed]/more:-rotate-90" />
                </CollapsibleTrigger>
              </SidebarGroupLabel>
              <CollapsibleContent>
                <SidebarGroupContent>
                  <SidebarMenu className="gap-0.5">
                    {nav.more.map((l) => (
                      <NavRow key={l.key} link={l} pathname={pathname} status={status} />
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </Collapsible>
          </SidebarGroup>
        )}

        {nav.settings && (
          <SidebarGroup className="mt-auto p-2">
            <SidebarMenu>
              <NavRow link={nav.settings} pathname={pathname} status={status} />
            </SidebarMenu>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-tc-sidebar-border p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" className="h-12 gap-2.5 px-2 data-[state=open]:bg-tc-sidebar-active group-data-[collapsible=icon]:!p-0">
                  <Avatar className="size-8 rounded-[8px]">
                    <AvatarFallback className="rounded-[8px] bg-linear-135 from-[#2b8cff] to-[#6a5cff] text-[12px] font-bold text-white">
                      {initials(displayName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left leading-tight">
                    <span className="truncate text-[14px] font-semibold text-tc-ink">{name}</span>
                    <span className="truncate text-[12px] text-tc-muted">{ROLE_LABEL[role]}</span>
                  </div>
                  <ChevronsUpDown className="ml-auto !size-4 text-tc-faint" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top" className="w-56 rounded-[10px]">
                <DropdownMenuLabel className="leading-tight">
                  <div className="text-[13px] font-semibold text-tc-ink">{name}</div>
                  <div className="text-[12px] font-normal text-tc-muted">{ROLE_LABEL[role]}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <form action={signOut}>
                  <DropdownMenuItem asChild className="w-full gap-2 text-tc-danger-ink">
                    <button type="submit">
                      <LogOut className="size-4" /> Sign out
                    </button>
                  </DropdownMenuItem>
                </form>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
