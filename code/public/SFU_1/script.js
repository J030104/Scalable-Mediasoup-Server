import PageController from './src/utilities/pageController.js';
import ButtonController from './src/utilities/buttonController.js';

// Initialize PageController with default values
const page = new PageController();
const button = new ButtonController();

// Add "Next" and "Previous" buttons for paging
const addPagingControls = () => {
    // Select the buttons
    const previousButton = document.querySelector('.pagingButton.previous'); // Use querySelector for a single element
    const nextButton = document.querySelector('.pagingButton.next');

    // Add event listeners
    if (previousButton) {
        previousButton.addEventListener('click', () => page.goToPage(-1));
    }

    if (nextButton) {
        nextButton.addEventListener('click', () => page.goToPage(1));
    }
};

const Update = () => {
    page.updateVideoContainer();
    page.updateDerivedValues();
    page.updateVideoScaling();
    page.updateButtonVisibility();
}

const Initialize = () => {
    // Recalculate layout on window resize
    window.addEventListener('resize', Update);

    // Add paging controls on load
    addPagingControls();

    // Event listener to watch for page changes
    document.dispatchEvent(new CustomEvent('pageChanged', { detail: { currentPage: page.currentPage } }));
    document.addEventListener('pageChanged', (event) => {
        console.log(`Current Page is now: ${event.detail.currentPage}`);
    });

    // Listen for page changes to update button visibility
    document.addEventListener('pageChanged', page.updateButtonVisibility);

    // Add event listeners for the buttons
    document.addEventListener('DOMContentLoaded', button.addControlButtonEvent);


    // Add event listener to the mute button
    document.addEventListener('DOMContentLoaded', async () => {
        const videoElement = document.getElementById('localVideo');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            videoElement.srcObject = stream;

            // Attach event listener to the video button
            const videoButton = document.querySelector('.btn-video');
            if (videoButton) {
                videoButton.addEventListener('click', button.toggleVideo);
            }
        } catch (error) {
            console.error("Error accessing media devices:", error);
        }
    });

    // Add event listener to the mute button
    document.addEventListener('DOMContentLoaded', () => {
        const closeBtn = document.querySelector('.btn-close');
        const copyBtn = document.querySelector('.btn-copy');
        closeBtn.addEventListener('click', button.closeInviteModal);
        copyBtn.addEventListener('click', button.copyInviteURL);
    });
    
}

Initialize();

// ============================================================
// Simutlate adding a video to the call
// ============================================================

document.getElementById("add-video-btn").addEventListener("click", () => {
    const remoteVideoContainer = document.getElementById("videoContainer");

    const videoElement = document.createElement("video");
    videoElement.classList.add("small-video");
    videoElement.autoplay = true;
    videoElement.muted = true; // Simulate remote video for now

    // Add video to the container
    remoteVideoContainer.appendChild(videoElement);

    // Update video count attribute for dynamic resizing
    const videoCount = remoteVideoContainer.children.length;
    remoteVideoContainer.setAttribute("data-video-count", videoCount);

    // Update scaling
    page.updateVideoScaling();
    page.updateButtonVisibility();
});

// ============================================================
// Simulate deleting a random video from the call
// ============================================================
document.getElementById('delete-random-video').addEventListener('click', () => {
    const remoteVideoContainer = document.getElementById("videoContainer");
    const videos = remoteVideoContainer.children;

    // Check if there are any videos to delete
    if (videos.length === 0) {
        alert("No videos to delete!");
        return;
    }

    // Pick a random video to delete
    const randomIndex = Math.floor(Math.random() * videos.length);
    const videoToDelete = videos[randomIndex];

    // Remove the video element from the container
    videoToDelete.remove();

    // Update layout and paging
    page.updateVideoScaling();
    page.updateButtonVisibility();
});