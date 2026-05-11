<script lang="ts">
  import { profile } from '../lib/profile.svelte'
  import { resizeImage } from '../lib/image'

  let editing = $state(false)
  let draftName = $state(profile.name)
  let draftNotes = $state(profile.notes)
  let uploadErr = $state<string | null>(null)
  let fileInput: HTMLInputElement | null = $state(null)

  function startEdit() {
    draftName = profile.name
    draftNotes = profile.notes
    uploadErr = null
    editing = true
  }

  function cancelEdit() {
    draftName = profile.name
    draftNotes = profile.notes
    uploadErr = null
    editing = false
  }

  function saveEdit() {
    profile.setName(draftName)
    profile.setNotes(draftNotes)
    editing = false
  }

  async function onFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    uploadErr = null
    try {
      const url = await resizeImage(file, 400)
      profile.setPhoto(url)
    } catch {
      uploadErr = 'อัปโหลดล้มเหลว — ลองใหม่'
    } finally {
      input.value = ''
    }
  }

  function removePhoto() {
    profile.setPhoto(null)
  }
</script>

<div class="glass overflow-hidden flex flex-col" data-component="profile-card">
  <div class="flex" style="min-height:220px;">
    <div class="flex-1 min-w-0 flex flex-col" style="padding:var(--card-pad-y) var(--card-pad-x);">
      {#if !editing}
        <div class="flex items-start justify-between gap-2">
          <div class="flex-1 min-w-0">
            <div class="label-mono">Profile</div>
            <div
              class="ff-display mt-2"
              style="font-size:var(--text-xl); font-weight:600; letter-spacing:-0.01em; color:var(--text);"
              data-profile-name
            >{profile.name}</div>
          </div>
          <button
            type="button"
            class="ff-mono uppercase cursor-pointer shrink-0"
            style="padding:5px 10px; font-size:9px; letter-spacing:0.12em; background:var(--surface-glass); color:var(--text-muted); border:0.5px solid var(--border-glass); border-radius:4px;"
            data-action="edit-profile"
            onclick={startEdit}
          >EDIT</button>
        </div>

        <div
          class="mt-3 flex-1 overflow-y-auto"
          style="font-size:var(--text-base); line-height:1.65; color:var(--text-muted); white-space:pre-wrap; word-break:break-word;"
          data-profile-notes
        >{profile.notes || 'No notes yet — click EDIT to add some.'}</div>
      {:else}
        <div class="flex items-start justify-between gap-2">
          <div class="label-mono">Editing profile</div>
          <div class="flex gap-1.5 shrink-0">
            <button
              type="button"
              class="ff-mono uppercase cursor-pointer"
              style="padding:5px 12px; font-size:9px; letter-spacing:0.12em; background:var(--accent); color:#1A1018; border:0.5px solid var(--accent); border-radius:4px; font-weight:600;"
              data-action="save-profile"
              onclick={saveEdit}
            >Save</button>
            <button
              type="button"
              class="ff-mono uppercase cursor-pointer"
              style="padding:5px 10px; font-size:9px; letter-spacing:0.12em; background:transparent; color:var(--text-muted); border:0.5px solid var(--border-glass); border-radius:4px;"
              data-action="cancel-profile"
              onclick={cancelEdit}
            >Cancel</button>
          </div>
        </div>

        <input
          type="text"
          bind:value={draftName}
          placeholder="Name"
          class="ff-display mt-2"
          style="font-size:var(--text-lg); font-weight:600; letter-spacing:-0.01em; padding:6px 10px; background:var(--surface-glass); border:0.5px solid var(--border-glass); border-radius:var(--radius-sm); color:var(--text); outline:none; width:100%;"
          data-field="profile-name"
        />

        <textarea
          bind:value={draftNotes}
          placeholder="Free notes — anything that matters today."
          class="ff-body mt-3 flex-1"
          style="font-size:var(--text-base); line-height:1.65; padding:10px 12px; background:var(--surface-glass); border:0.5px solid var(--border-glass); border-radius:var(--radius-sm); color:var(--text); outline:none; resize:none; min-height:80px;"
          data-field="profile-notes"
        ></textarea>
      {/if}
    </div>

    <div
      class="shrink-0 relative overflow-hidden"
      style="width:var(--photo-portrait-w); max-width:50%; border-left:0.5px solid var(--border-glass);"
    >
      {#if profile.photo}
        <img
          src={profile.photo}
          alt="Profile"
          style="position:absolute; inset:8px; width:calc(100% - 16px); height:calc(100% - 16px); object-fit:cover; object-position:center top; border-radius:10px; box-shadow:0 4px 16px rgba(0,0,0,0.25);"
          data-profile-photo
        />
        {#if editing}
          <button
            type="button"
            onclick={removePhoto}
            class="ff-mono uppercase cursor-pointer absolute"
            style="bottom:12px; right:12px; padding:5px 9px; font-size:9px; letter-spacing:0.12em; background:rgba(0,0,0,0.5); color:var(--text); border:0.5px solid var(--border-glass-strong); border-radius:4px; backdrop-filter:blur(8px);"
            data-action="remove-photo"
          >Remove</button>
        {/if}
      {:else}
        <button
          type="button"
          class="absolute inset-2 flex flex-col items-center justify-center gap-2 cursor-pointer"
          style="border-radius:10px; border:0.5px dashed var(--border-glass); background:var(--surface-glass); color:var(--text-faint);"
          onclick={() => fileInput?.click()}
          data-action="upload-photo"
          aria-label="Upload profile photo"
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
          </svg>
          <span class="ff-mono" style="font-size:9px; letter-spacing:0.12em;">UPLOAD PHOTO</span>
        </button>
      {/if}

      {#if profile.photo && !editing}
        <button
          type="button"
          onclick={() => fileInput?.click()}
          class="absolute cursor-pointer flex items-center justify-center"
          style="bottom:14px; right:14px; width:28px; height:28px; border-radius:50%; background:rgba(0,0,0,0.5); border:0.5px solid var(--border-glass-strong); color:var(--text); backdrop-filter:blur(8px);"
          aria-label="Replace photo"
          data-action="replace-photo"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
      {/if}

      <input
        type="file"
        accept="image/*"
        bind:this={fileInput}
        onchange={onFile}
        style="display:none;"
        data-field="photo-input"
      />
    </div>
  </div>

  {#if uploadErr}
    <div
      class="ff-mono"
      style="padding:6px 16px; font-size:10px; color:var(--accent-bright); border-top:0.5px solid var(--border-glass); background:rgba(232,133,94,0.08);"
      data-upload-error
    >{uploadErr}</div>
  {/if}
</div>
