import PageController from './utilities/pageController.js';
import ButtonController from './utilities/buttonController.js';

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
    document.addEventListener('DOMContentLoaded', () => {
        const closeBtn = document.querySelector('.btn-close');
        const copyBtn = document.querySelector('.btn-copy');
        closeBtn.addEventListener('click', button.closeInviteModal);
        copyBtn.addEventListener('click', button.copyInviteURL);
    });

    // Add event listener for video changes
    const videoContainer = document.getElementById('videoContainer');
    const config = { childList: true, subtree: true };
    const callback = (mutationsList, observer) => {
        for (const mutation of mutationsList) {
            if (mutation.type === 'childList') {
                document.dispatchEvent(new CustomEvent('videoChanged', { detail: { videoLength: videoContainer.children.length } }));
            }
        }
    };
    const observer = new MutationObserver(callback);
    observer.observe(videoContainer, config);
    document.dispatchEvent(new CustomEvent('videoChanged', { detail: { videoLength: videoContainer.children.length} }));
    document.addEventListener('videoChanged', (event) => {
        console.log(`Video changed: ${event.detail.videoLength}`);
        Update();
    });
}

Initialize();

// ============================================================
// Simutlate adding a video to the call
// ============================================================

// document.getElementById("add-video-btn").addEventListener("click", () => {
//     const remoteVideoContainer = document.getElementById("videoContainer");

//     const videoElement = document.createElement("video");
//     videoElement.classList.add("small-video");
//     videoElement.autoplay = true;
//     videoElement.muted = true; // Simulate remote video for now

//     // Add video to the container
//     remoteVideoContainer.appendChild(videoElement);

//     // Update video count attribute for dynamic resizing
//     const videoCount = getRemoteVideoCount();
//     remoteVideoContainer.setAttribute("data-video-count", videoCount);

//     // Update scaling
//     page.updateVideoScaling();
//     page.updateButtonVisibility();
// });

// ============================================================
// Simulate deleting a random video from the call
// ============================================================
// document.getElementById('delete-random-video').addEventListener('click', () => {
//     const remoteVideoContainer = document.getElementById("videoContainer");
//     const videos = remoteVideoContainer.children;

//     // Check if there are any videos to delete
//     if (videos.length === 0) {
//         alert("No videos to delete!");
//         return;
//     }

//     // Pick a random video to delete
//     const randomIndex = Math.floor(Math.random() * videos.length);
//     const videoToDelete = videos[randomIndex];

//     // Remove the video element from the container
//     videoToDelete.remove();

//     // Update layout and paging
//     page.updateVideoScaling();
//     page.updateButtonVisibility();
// });