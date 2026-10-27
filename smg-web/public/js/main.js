"use strict";

// Menú móvil accesible
const burger = document.getElementById("burgerBtn");
const navLinks = document.getElementById("navLinks");

function closeMenu() {
  navLinks?.classList.remove("open");
  burger?.setAttribute("aria-expanded", "false");
  burger?.setAttribute("aria-label", "Abrir menú");
}

burger?.addEventListener("click", () => {
  const isOpen = navLinks.classList.toggle("open");
  burger.setAttribute("aria-expanded", String(isOpen));
  burger.setAttribute("aria-label", isOpen ? "Cerrar menú" : "Abrir menú");
});
navLinks?.querySelectorAll("a").forEach(link => link.addEventListener("click", closeMenu));
document.addEventListener("keydown", e => { if (e.key === "Escape") closeMenu(); });

// Formulario: envía la solicitud al servidor, que la guarda en un archivo.
const contactForm = document.getElementById("contactForm");
const formNote = document.getElementById("formNote");
const submitButton = contactForm?.querySelector('button[type="submit"]');

function setNote(text, kind) {
  if (!formNote) return;
  formNote.textContent = text;
  formNote.classList.remove("ok", "error");
  if (kind) formNote.classList.add(kind);
}

contactForm?.addEventListener("submit", async event => {
  event.preventDefault();
  if (!contactForm.reportValidity()) return;

  const name = document.getElementById("name").value.trim();
  const email = document.getElementById("email").value.trim();
  const message = document.getElementById("message").value.trim();
  const website = document.getElementById("website").value;

  if (name.length < 2 || message.length < 5) {
    setNote("Escribe un nombre y un mensaje válidos.", "error");
    return;
  }

  if (submitButton) { submitButton.disabled = true; submitButton.textContent = "Enviando…"; }
  setNote("Enviando tu solicitud…");

  try {
    const response = await fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, message, website })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Solicitud fallida (${response.status})`);
    contactForm.reset();
    setNote("¡Gracias! Tu solicitud se guardó correctamente. Nos pondremos en contacto contigo.", "ok");
  } catch (error) {
    console.error("No se pudo guardar el mensaje:", error);
    const offline = error instanceof TypeError;
    setNote(offline ? "No hay conexión con el servidor. Inténtalo de nuevo en unos minutos." : (error.message || "No pudimos guardar tu solicitud. Inténtalo de nuevo más tarde."), "error");
  } finally {
    if (submitButton) { submitButton.disabled = false; submitButton.textContent = "Enviar mensaje"; }
  }
});
