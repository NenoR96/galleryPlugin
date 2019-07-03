import React, { Component } from 'react';
import { hot } from 'react-hot-loader/root';
import { Route, Router } from 'react-router-dom';
import { createMemoryHistory } from 'history';

import PhotoSwipe from '../assets/photoswipe.min.js';
import photoSwipeUIdefault from '../assets/photoswipe-ui-default.min.js';

import { ViewFolder, Folders, Gallery, NavBar, PswpGallery } from '.';

const {
  datastore,
  messaging,
  history,
  navigation,
  appearance,
  getContext,
  device,
  spinner,
  bookmarks,
  deeplink,
  imageLib
} = window.buildfire;

class Widget extends Component {
  constructor(props) {
    super(props);
    this.History = createMemoryHistory();
    this.gallery = null;
    this.state = {
      images: [],
      folders: [],
      pathname: '/',
      folder: null,
      view: 'gallery',
      showImageModal: false,
      index: 0,
      pswpOpen: false
    };
  }

  viewFolder = folder => {
    this.setState(() => ({ folder }), () => this.navigateTo('/folder'));
  };

  changeView = view => {
    this.setState(() => ({ view }));
  };

  viewImage = src => {
    spinner.show();
    const { images, folder } = { ...this.state };
    const folderImages = folder ? folder.images : null;

    const index = (folderImages || images).findIndex(image => image.src === src);
    const pswpEle = document.getElementsByClassName('pswp')[0];
    const options = {
      index,
      getDoubleTapZoom: (isMouseClick, item) => {
        if (isMouseClick) {
          return 1;
        }
        return item.initialZoomLevel < 0.7 ? 2 : 1.33;
      },
      maxSpreadZoom: 4,
      spacing: 0,
      preload: [1, 1]
    };

    const optimizeImage = config => {
      const { croppedSrc, width, height, compression } = config;
      if (!croppedSrc.includes('cloudimg.io')) {
        return croppedSrc;
      }

      return croppedSrc.replace(
        /\/s\/crop\/\d+\D\d+\//g,
        `/crop/${Math.floor(width)}x${Math.floor(height)}/${compression || 'n'}/`
      );
    };

    const galleryItems = (folderImages || images).map(img => {
      const croppedSrc = imageLib.cropImage(img.src, { width: img.width, height: img.height });
      const { width, height } = img;
      return {
        w: img.width,
        h: img.height,
        msrc: optimizeImage({
          croppedSrc,
          width: width / 2,
          height: height / 2,
          compression: 'q20.fgaussian4'
        }),
        src: optimizeImage({ croppedSrc, width, height, compression: 'q100' }),
        sourceImg: img.src
      };
    });
    this.gallery = new PhotoSwipe(pswpEle, photoSwipeUIdefault, galleryItems, options);
    this.gallery.init();

    this.setState(() => ({ pswpOpen: true }));

    this.gallery.listen('close', () => {
      spinner.hide();
      this.setState(() => ({ pswpOpen: false }));
    });
    this.gallery.listen('imageLoadComplete', () => spinner.hide());
  };

  shareImage = () => {
    spinner.show();
    const { sourceImg } = this.gallery.currItem;
    const obj = { image: sourceImg };
    device.share(obj, () => spinner.hide());
  };

  bookmark = () => {
    const { folder } = { ...this.state };
    const isBookmarked = folder.bookmarked;

    const options = {
      id: folder.id,
      title: folder.title,
      payload: { id: folder.id },
      icon: folder.images[0].src
    };
    const onAdd = err => {
      if (err) throw err;
      this.setState(state => {
        state.folder.bookmarked = true;
        return { folder: state.folder };
      });
    };
    const onDelete = err => {
      if (err) throw err;
      this.setState(state => {
        state.folder.bookmarked = false;
        return { folder: state.folder };
      });
    };
    if (isBookmarked) bookmarks.delete(folder.id, onDelete);
    else bookmarks.add(options, onAdd);
  };

  navigateTo = path => {
    this.History.replace(path || '/');
    history.push(path, { elementToShow: path });
  };

  getDld = () => {
    deeplink.getData(data => {
      if (data && data.id) {
        const { folders } = this.state;
        const folder = folders.find(({ id }) => id === data.id);

        this.viewFolder(folder);
      }
    });
  };

  getBookmarked = folders => {
    const cb = (err, results) => {
      if (err) throw err;
      const bookmarkIds = results.map(bookmark => bookmark.id);
      folders = folders.map(folder => {
        folder.bookmarked = bookmarkIds.includes(folder.id);
        return folder;
      });
      this.setState(() => ({ folders }));
    };
    bookmarks.getAll(cb);
  };

  clearFolder = () => this.setState(() => ({ folder: null }));

  componentDidMount = () => {
    const loadData = (err, result, instanceId) => {
      if (err) throw err;
      const { images, folders } = result.data;
      if (!images && !folders) return;
      this.setState(
        state => {
          let { folder } = { ...state };

          if (folder) {
            folder = folders.find(({ id }) => id === folder.id);
          }
          this.getBookmarked(folders);
          return { images, folders, folder: folder || null };
        },
        () => this.getDld()
      );

      localStorage.setItem(`${instanceId}.gallery_cache`, JSON.stringify(result.data));
    };

    getContext((err, context) => {
      if (err) throw err;
      const { instanceId } = context;

      datastore.get('gallery', (error, result) => {
        loadData(error, result, instanceId);
      });
      datastore.onUpdate(result => {
        loadData(null, result, instanceId);
      }, false);

      const cache = localStorage.getItem(`${instanceId}.gallery_cache`);
      if (cache) {
        loadData(null, { data: JSON.parse(cache) });
      }
    });

    this.History.listen(location => {
      const { pathname } = location;
      this.setState(() => ({ pathname }));
    });

    messaging.onReceivedMessage = message => {
      switch (message.type) {
        case 'home': {
          this.navigateTo('/');
          break;
        }
        case 'folder': {
          this.viewFolder(message.folder);
          break;
        }
        default:
          break;
      }
    };

    const goBack = navigation.onBackButtonClick;
    navigation.onBackButtonClick = () => {
      const { pswpOpen } = this.state;
      if (pswpOpen) {
        this.gallery.close();
      } else if (this.History.location.pathname === '/') {
        goBack();
      } else {
        history.pop();
      }
    };

    history.onPop(b => {
      this.History.replace(b.options.elementToShow || '/');
    }, false);

    if (window.location.href.indexOf('localhost') > -1) {
      getContext((err, context) => {
        if (err) throw err;
        // eslint-disable-next-line max-len
        appearance.attachAppThemeCSSFiles(
          context.appId,
          context.liveMode,
          context.endPoints.appHost
        );
      });
    }
  };

  // componentDidUpdate = () => console.warn(this.state);

  render() {
    const { images, folders, folder, view, pathname } = this.state;

    return (
      <div>
        {folders && folders.length > 0 && (
          <NavBar
            view={view}
            pathname={pathname}
            changeView={this.changeView}
            folder={folder}
            bookmark={this.bookmark}
          />
        )}
        <Router history={this.History}>
          <Route
            exact
            path="/"
            render={() => {
              if (view === 'gallery') {
                return (
                  <Gallery
                    images={images}
                    folders={folders}
                    view={view}
                    viewImage={this.viewImage}
                    clearFolder={this.clearFolder}
                  />
                );
              }
              return <Folders folders={folders} images={images} viewFolder={this.viewFolder} />;
            }}
          />
          <Route
            exact
            path="/folders"
            render={() => (
              <Folders folders={folders} images={images} viewFolder={this.viewFolder} />
            )}
          />
          <Route
            exact
            path="/folder"
            render={() => <ViewFolder folder={folder} viewImage={this.viewImage} />}
          />
        </Router>
        <PswpGallery shareImage={this.shareImage} />
      </div>
    );
  }
}

export default hot(Widget);
